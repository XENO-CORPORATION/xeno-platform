# Chat → XENO Elements adoption — the remaining work

**Goal:** every control in the chat interface is either a `@xenosystem/elements-react` component or
hand-written with a reason written next to it.

This file is the working spec for that. It is written to be read by an agent that has **no memory of
the last iteration** — so it never says "continue where you left off". Every section starts by
MEASURING the current state, and the measurement is the source of truth. If this document and the
repo disagree, the repo is right and this document is stale.

---

## Where this stands

**The adoption is finished. The measurement programme has reached the end of what it can reach.**

Read this before the detail; the sections below are the working record and are longer than the state
they describe.

### What is done

Every `<button>` and every field in the chat is either a `@xenosystem/elements-react` component or
hand-written **with the reason beside it**. §3 and §7 both report **0 still to decide** — 243 adopted
components in the source, 72 buttons and 21 fields hand-written on purpose, 4 fields excluded as
pickers and sliders.

`npm run test:chat` is 10/10 with an empty KNOWN_RED. `npm run probe:chat` is 12 browser probes in
~170s; `probe:chat:full` adds two slow ones and takes ~510s.

**Seven doors were cut into the library** because a call site could not say something (§3.3b), each
with a test: `iconSize`, `fontSize`, `mono`, `emphasis="solid"`, `iconReveal="trailing"`,
`selectionStyle="ring"`. 894 library tests green on `feat/soft-chrome`.

### What is left, and whose it is

Four §9 findings are the **owner's**, re-checked every run by `probe-open-findings`: two chat surface
roles with no variant member, a blue cluster the theme does not reach, three unread `data-` state
hooks, and the per-theme token collisions. Closing the first means adding palette, and
`DESIGN_SYSTEM.md` is LOCKED.

Coverage is **55%** — 140 of 255 adopted components rendered. The remainder is not measurement error
(§6): `isMultiInterface`'s six controls sit behind a sign-in wall and `isRecentFilesOpen`'s two behind
`display: none`. **The next gain needs a test account, not another path.**

### What this cost, and the part worth keeping

The measurement was wrong more often than the code was. **Nine probe false positives**, tabulated in
§6 — including one repeat of a trap I had written into that very table two iterations earlier, one
selector typo that reported a component as never-rendered for the entire programme while three of it
sat on screen, and three in a row chasing a reported hover regression where nothing was broken.

Coverage went 24 → 27 → 31 → 32 → 39 → 40 → **36** → 37 → 38 → 39 → 40 → 41 → 47 → 48 → 49 → 53 → 55.
The drop to 36 is the most trustworthy number in that list: every rise came from reaching further into
the app, and that one came from asking what the number was counting.

**If you are picking this up:** run §0's four commands first and trust their output over any summary,
including this one. The board has contradicted a confident prose claim at least once.

---

## 0. Orient — run this first, every time

```bash
cd C:/code-dev/xeno-platform
node scripts/check-undefined-names.mjs src/components/playground/Chat   # must be clean before starting
npm run test:chat                                                       # must be green before starting
npm run probe:chat                                                      # must be green before starting (~170s)
git status --short                                                      # must be clean before starting
```

`test:chat` runs all ten `test-chat-*.mjs`. Its KNOWN_RED list is **empty** — every test passes — so
anything it reports is yours. It went in after six of the ten were found failing at once, four of
them from conversions that dropped a `data-` hook or moved a `<style>` block out from under a test
that read it. The other three were red for over a month because they sliced the source at a marker a
later pass deleted, so they failed on their FIRST LINE and none of their assertions had run since.
**A test that fails early stops describing anything** — that is why the list is empty rather than
tolerated.

`probe:chat` runs the twelve fast browser probes and checks each one's number against a recorded
expectation. `probe:chat:full` adds the two slow ones — run it on any commit that touches the walk,
the theme tokens or the bridge.
Same rule, and one more: **if you change what a probe measures, update its `expect` in the same
commit**. An expectation edited later than the change it describes is how a baseline rots.

**Green before you start, green before you commit.**

If `git status` shows changes you did not make, **stop and report**. Someone else works in this repo.

Then count what is left:

```bash
node scripts/spec-status.mjs
```

That prints the per-file button count, the field count, and what is already adopted. Work the file
with the **smallest non-zero count** first — small files finish, and a finished file is a result.
`ChatWithLLM.tsx` is more than half the total and is worked last.

The count is of buttons **still to decide**, not of `<button>` tags. A control that stays hand-written
for a reason is finished work, so the board stops counting it — otherwise a file whose every
remaining control has already been decided keeps coming up as the smallest, and an agent with no
memory of the last iteration re-derives the same decisions forever.

**How to mark one: a comment directly above the `<button>` opening with the words `Stays
hand-written`,** then the reason. The phrase is the marker; the sentence after it is the point.

---

## 1. What one iteration is

**One iteration = one file's worth of a single control type, or 3–6 controls, whichever is smaller.**

Not more. Four automated sweeps have been attempted on this work and every one of them produced
damage that a dry run caught (§5). The rate is the argument for small batches, not the exception to
it.

A full platform build takes **60–90 seconds**, longer than the loop interval. An iteration that ends
mid-build is fine: the next one starts at §0, sees a dirty tree, and finishes the verification before
starting new work. Do not start a second conversion while a build is unverified.

### The shape of an iteration

1. `git status` clean, `check:names` and `check:jsx-comments` clean, `test:chat` and `probe:chat`
   green (§0)
2. Read the buttons in the target file (§2)
3. Convert 3–6 of them by hand (§3)
4. Export any missing `*Decl` from `src/lib/icons.tsx`, wire the imports
5. `node scripts/check-undefined-names.mjs src/components/playground/Chat` — must be clean
6. Sweep dead imports (§4)
7. `npm run build` — must print `✓ built`
8. Verify (§6): `npm run probe:chat`, plus a targeted measurement of what you changed
9. Commit, push
10. Stop. The next iteration re-measures.

**Step 7 comes before step 8, and that ordering is not cosmetic.** A syntax error takes the route
down, and a probe pointed at a dead route times out looking for a root that never mounts — several
minutes to learn nothing, where the build says it in one line. Build, then measure.

### When there is nothing left to convert

§3 and §7 both reached zero, so an iteration is now one of these instead, and the same rules apply —
one per iteration, measured before and after:

- **Close a §9 finding**, or re-check one and record why it stays open. Saying so *with the
  measurement* is a result, and so is correcting an earlier measurement.
- **Sweep a seam** — a place where a wrong decision hides in a shape rather than in a file. The six
  swept are listed in §9; each found something the file-by-file read had not.
- **Consolidate** — a probe runner, a spec section that has gone stale, a memory file that predates
  the work. The spec is read by an agent with no memory of the last iteration, so a stale instruction
  in §§0–5 costs more than a stale comment in the source.

---

## 2. Reading a file's controls

```bash
node scripts/spec-status.mjs --file ChatSettingsModal
```

Prints every remaining `<button>` in that file with its line, its glyphs, its label, its resolved
class (shared `const` class strings are expanded), and its computed box. Without `--file` it also
reports the FIELD buckets — §7's `<input>` and `<textarea>` split the same three ways as §3's
buttons — and the dead-import sweep (§4) is the same script with `--dead-imports`.

**Read the code around each one before converting it.** The listing is a map, not a substitute.

---

## 3. The conversion rules

### 3.1 Which component

| The button is | Component |
|---|---|
| one glyph, no text | `<IconButton icon={…Decl} />` |
| glyph + text, or text only | `<Button leadingIcon={…Decl}>text</Button>` |

### 3.2 Which variant — read it off what the button already is

| It currently has | `variant` |
|---|---|
| a fill of `--chat-accent` or `--chat-text`, with inverted ink | `primary` |
| a border **and** a fill of `--chat-control` / `--chat-surface` / `--chat-elevated` | `secondary` |
| a border, no fill, ink at full strength | `outline` |
| a border, no fill, MUTED ink | `quiet` |
| no border, no fill | `ghost` |
| a border, muted ink, going RED when reached for | `danger` |
| a solid `--chat-danger` fill | `danger` + `emphasis="solid"` |

This is not a taste call. If the mapping is unclear, the button is unusual — leave it and say so.

Two rows that used to be wrong here, both fixed by measuring rather than reading:

- **`danger` is the QUIET reading**, not a red slab: a neutral hairline with muted ink that turns red
  only on hover. This table used to say "anything reaching for `--chat-danger`", which would put a
  hairline where a delete dialog's confirm belongs. `emphasis="solid"` is the other reading.
- **`quiet` and `danger` are identical at rest** — transparent fill, muted ink, a hairline — and
  differ only on hover. A resting screenshot cannot tell them apart; the label and the hover can.

`primary` was unusable in this chat until the bridge carried the chrome tokens, and older comments in
the source still say so. It works now; treat that sentence as expired wherever it appears.

### 3.3 Which size — from the box it already occupies

The control scale is **xs 24 · sm 28 · md 32 · lg 36**, glyphs 15/16/16/18.

- `h-6`→xs, `h-7`→sm, `h-8`→md, `h-9`→lg, `h-10`→lg
- no explicit height: box = glyph px + 2 × padding. `p-1`=4, `p-1.5`=6, `p-2`=8, `p-2.5`=10, `p-3`=12
- pick the nearest step

**Keep the current glyph px with `iconSize`.** A component swap and a resize are two edits; the swap
should not silently be both. `iconSize` exists for exactly this.

### 3.3b The doors — before deciding a control cannot convert

Seven of these were added during this adoption, each because a call site could not say something. Check
the list before writing a `Stays hand-written` reason, and check it again before believing one you
find: **two controls stayed hand-written for a whole pass on a reason that a door had already
answered.**

| The call site needs to say | Prop |
|---|---|
| this glyph is drawn at N px, not the size token's | `iconSize` on `Button` / `IconButton` / `TextInput` / `SegmentedControl` |
| this field's TYPE is N px, not the size token's | `fontSize` on `TextInput` / `Textarea` |
| this field is code | `mono` on `Textarea` — uses `--xeno-font-mono`, which the system already declares |
| this destructive action is the confirm, not the affordance | `emphasis="solid"` on `Button` |
| the glyph reveals from under the label | `iconReveal` — `true`/`"leading"`, or `"trailing"` for the mirror |
| chosen is a RING, not a fill | `selectionStyle="ring"` on `ToggleButton` / `Tab` — the fill has a surface precondition; a hairline does not |
| I drive my own tablist and only need the ROW | `<Tab>` — `<Tabs>` owns the panel and the keys, which is unusable when two tablists share one panel. Spreads `tabProps` last, so `useTabs` still wins |

If a control needs something not on this list, **add the door and a test in the library** rather than
converting around it (§5.3). Prefer a MODE that reaches a token the system already declares over
another override prop — `mono` is the example, and it is why there is no `fontFamily`.

### 3.4 What to carry over, and what to drop

| Keep | Drop |
|---|---|
| every prop that is not `className`, `type` or `style` | `type="button"` — the component sets it |
| — | **`style` — never pass it.** `ButtonProps` omits it deliberately; it rides in on the prop spread because the build strips types without checking. EVERY component in this chat found wearing one was a variant reproducing another by hand |
| LAYOUT classes: `flex-1`, `w-full`, `min-w-*`, `max-w-*`, `ml-*`, `self-*`, `order-*`, `absolute`, `z-*`, all `sm:`/`md:`/`lg:` | APPEARANCE classes: `p-*`, `h-*`, `w-*` (when square), `rounded-*`, `text-*`, `bg-*`, `border*`, `hover:*`, `transition*` |
| product hooks: `data-*`, `chat-*` class names that CSS or JS targets | `data-*` hooks nothing references — grep first, **`scripts/` and `*.css` included** |
| the accessible name | a visually-hidden `<span className="sr-only">` — becomes `aria-label` |

### 3.5 Conditional faces stay one button

A control with two faces — copy/copied, play/pause, next/dismiss — stays ONE button. The ternary
moves into the prop:

```tsx
leadingIcon={copied ? CheckDecl : CopyDecl}
icon={isActive ? PauseDecl : PlayDecl}
```

This is what makes the check **draw** rather than appear: the glyph animates when its own state
changes, and swapping one element for another gives it nothing to animate from.

If the glyph carries a `selection` state, pass it — `iconState={{ selection: … }}` on both
`IconButton` and `MenuItem`. Losing it is silent (§5.3).

### 3.6 Left-pointing glyphs

The library draws `arrow-right` and `chevron-right` and no left twin, deliberately: one geometry,
mirrored where used. Inside a component the facade's inline flip cannot reach the glyph, so:

```tsx
<IconButton icon={ArrowRightDecl} className="chat-icon-flip-x" … />
```

`.chat-icon-flip-x` lives in `src/components/playground/Chat/chat-theme.css`.

### 3.7 Missing declarations

`icon` and `leadingIcon` take an `ElementDeclaration`, not a component. If `FooDecl` does not exist,
add it to the export block at the bottom of `src/lib/icons.tsx`:

```ts
GUnderlyingGlyph as FooDecl,
```

`check:names` catches a forgotten one; the build does not.

---

## 4. The dead-import sweep — run it every iteration

Converting a call site orphans its icon import, and an unused import is legal, so it accumulates
silently. **53 had piled up before anyone looked.**

```bash
node scripts/spec-status.mjs --dead-imports --fix
```

---

## 5. The traps, each of which has already happened

Every one was caught by a dry run before it shipped. They are listed so the next pass does not have
to rediscover them.

**5.1 Truncated labels.** Stripping tags and pasting the remainder as a label turned
`{isProjectSidebarOpen ? … }` into the literal string `{isProjectSidebarOpen`. **A button body
containing `{` is an expression. Read it; do not extract it.**

**5.2 Dropped layout classes.** Replacing `className` wholesale took `flex-1 sm:flex-none` off two
dialog buttons. On a narrow screen they filled the row; they would have gone intrinsic-width with
nothing to say so. **Filter the class list (§3.4). Never drop it.**

**5.3 Dropped glyph state.** The carousel's next/dismiss button lost
`state={{ selection: showDismissInNav ? 'on' : 'off' }}` — the morph — because `IconButton` had no
`iconState` at the time. It has one now. **A component that cannot say what the call site said is not
ready for that call site: stop and add the door, do not convert around it.**

**5.4 Dead imports.** §4.

**5.4b Four ways a COMMENT breaks the app, all of them walked into more than once.** The build gate
catches the first three, which is why it runs before the commit and not after. **It cannot catch the
fourth** — read that one before applying the advice in the first.

1. **`{/* … */}` as the first thing inside `{cond && ( … )}`.** `{cond && ( {/* why */} <Button/> )}`
   is two expressions where one is allowed. Put a BARE `/* … */` above the `{cond &&` line or above
   the `return (`. Same for a comment as the sole child of a `return (`.
2. **A backtick inside ANY template literal you are writing prose into.** Originally this said "the
   `<style>{` … `}</style>` literal", and that narrowness is exactly why it failed to warn: the third
   occurrence was in `probe-coverage.mjs`, a plain `console.log(\`…\`)` explaining the coverage
   categories, where quoting a class name in backticks ended the literal and broke the script. A file
   with no JSX in it at all.

   The rule is about the DELIMITER, not the location. If you are typing an explanation inside
   backticks — a style block, a long `console.log`, a heredoc-ish template — do not quote code in
   backticks inside it. In a `<style>` block the failure is worse than a broken script: it takes the
   whole route down with a 500, and a probe aimed at it times out looking for a root that never
   mounts, which tells you nothing about the cause.
3. **`{/* … */}` in a JSX ATTRIBUTE position.** `<button data-x {/* why */} onClick=…>` parses as a
   spread. Put it above the element, or fold it into the prop's doc comment.
4. **A BARE `/* … */` in JSX CHILDREN position renders as a visible paragraph.** This is rule 1's
   advice applied one line too far, and it is the dangerous one, because **it is valid syntax**. It
   compiles, `check:names` is clean, `test:chat` is 10/10 and every probe is green — while six
   paragraphs of `Stays hand-written` prose sit down the sidebar between the nav rows, in the running
   app. Which it is depends only on the character BEFORE it:

   ```jsx
   {cond && (
     /* correct — a JS expression slot; `{…}` here would be an empty object literal */
     <Thing />
   )}

   </button>
   /* WRONG — JSX children, where anything not an element or a `{}` container is TEXT */
   <button>
   ```

   So the rule cannot be "always brace" or "never brace"; it is decided per site. **`npm run
   check:jsx-comments`** decides it mechanically — `>` or `}` before the comment and a `<` after it
   means children, means it leaks. Ten of the fourteen probes ran green over this bug because a probe
   measures ELEMENTS, and a leaked comment is a text node with no element to find. Verified the only
   way a gate is worth trusting: run it against the broken commit and watch it report exactly six.

**5.4c Read the markup before automating an interaction.** Two iterations went into opening the
recent-files panel — synthetic clicks, then a real `page.hover()` — before reading the JSX, which
answers it in a minute: the panel is `<div className="relative hidden">`, `display: none`
unconditionally. **A switched-off branch and a hard-to-drive hover fail identically from the
outside.** Check `display`, `visibility` and the class list first; the interaction is the expensive
thing to test and the markup is free to read.

**5.4d Match a hittability check to the click method.** A synthetic `el.click()` bypasses
`pointer-events` entirely; a real `page.click()` does not. Reusing the strict check with the
synthetic click reported "could not reach Projects" for a control that had just been clicked
successfully — several of this chat's rail controls rest at `pointer-events: none` until hovered.

**5.5 A hook dropped on a grep that only looked at `src/`.** Twice now: the carousel's
`data-update-carousel-dismiss` / `data-update-nav-morph`, and the composer's
`data-composer-upload`. Each time the conversion left a comment saying the attribute was referenced
nowhere, and each time `scripts/test-*.mjs` was reaching for it — so a test went red and stayed red,
because nothing runs those tests but a person who thinks to.

**So: `npm run test:chat`, before you touch anything and again before you commit.** It knows which
tests are already red and why, so anything it reports is yours. That is §0's second command and it is
there because this went unnoticed for days.

When a test asserts the OLD mechanism — `h-8`, `h-9 rounded-lg`, an inline `style.color` — move the
assertion to the new one rather than deleting it. `data-xeno-size="md"` is the same 32px said in the
scale's vocabulary, and it is the stricter statement of the two.

**5.5b The same mistake in the opposite direction: DELETING a hook because nothing seems to use it.**
Sweeping for unreferenced `data-` attributes fails exactly the way §5.5 failed, and the fix is the
same shape — search everywhere, `.css` and `scripts/` included, before believing "unused".

But the deeper trap is different: **unreferenced is the NORMAL state for an anchor.**
`data-chat-share-dialog=""` is a constant written once, there to BE selected; the ten chat tests are
built on precisely that affordance in the composer. Deleting the rest would remove the thing that
made the composer testable. `probe-dead-hooks.mjs` therefore splits the report in two — anchors
(constant, keep) from state (`data-melting={…}`, recomputed every render and read by nothing) — and
still calls neither a delete order.

**Only one hook was removed in this whole pass, and not for being unused.** `data-history-drag-shiftable`
duplicated a live mechanism: the CSS transition keys on the CLASS `history-drag-shiftable`, which the
same elements already carry. A duplicate does not merely sit there — it misdirects, and the next
reader takes the dead one for the working one.

A late corollary, found by writing a probe: **selecting a hook from a probe makes it referenced.**
Adding `probe-project-settings.mjs` took `data-project-settings-dialog` out of the unreferenced list,
20 → 19, and `probe:chat` failed on the change. That is the convention working, not a regression —
but the expectation moves in the same commit.

**Then the same corollary bit harder, and sharpened into a rule.** `probe-open-findings.mjs` re-checks
the §9 findings, and one of them is "three `data-` state hooks read by nothing". Naming those three
hooks in the re-check made all three look referenced — the count went **3 → 0**, and the finding
would have been retired *by the act of writing it down*.

**The observer has to be outside the population it counts.** `probe-dead-hooks.mjs` now excludes
that one file, and the distinction it forces is worth keeping: a probe that ASSERTS on a hook is a
real consumer (breaking it breaks the probe, which is exactly why §5.5 exists), while a probe that
merely LISTS a hook as a finding is not. Only the second kind gets excluded.

---

## 6. Verification — what counts as done

### Always, every iteration

```bash
npm run build                                                    # must print ✓ built
node scripts/check-undefined-names.mjs src/components/playground/Chat
```

The dev server on **:5183** is the user's; do not restart it. It may serve stale library CSS — when a
change to `../xeno-elements-foundations` seems not to apply, check the production build output rather
than assuming the code is wrong.

### The standing probes

```bash
npm run probe:chat
```

Fourteen probes, two commands. `probe:chat` runs twelve of them in ~170s; `probe:chat:full` adds the
two slow ones and takes ~430s. It grew because ten scripts that each had to be run
by hand and read by eye is a check nobody runs — and each printed a different shape of answer, so
"are they still green" was a question only someone who had read all ten could answer.

Each probe declares an EXPECTED number in `scripts/probe-chat.mjs`. The runner exits non-zero when
one moves, and distinguishes two things that mean opposite things:

- **FAIL** — the probe ran and its number changed. A regression, or a deliberate change; if
  deliberate, update its `expect` **in the same commit as the change**. An expectation edited later
  than the change it describes is how a baseline rots.
- **skip** — the probe could not run. `chat` probes need the dev server on :5183; `preview` probes
  need the elements preview on :5223, because :5183 serves a **stale copy of the library CSS**.
  A skip is printed loudly and never counts as a pass.

It also fails when a probe's output no longer contains the line its verdict reads — a verdict that
silently stops matching is a green light nobody is holding.

Verified both ways before being trusted: a moved number exits 1, and a dead server reports 9 skipped
rather than 9 passed.

The originals, for running one at a time when something fails:

```
scratchpad/audit3.mjs      67 hosts, 67 moving, 0 STILL
scratchpad/menusweep.mjs   page errors: none
scratchpad/final.mjs       lucideLeft: []
scratchpad/mixrow.mjs      every row adopted, h 32, r 6px, font 14
scripts/probe-light-ink.mjs     near-white ink on a LIGHT canvas, all three routes + dim
scratchpad/custom.mjs      chat and search identical at 15/30/65/85 %
scripts/probe-voicebright.mjs   voice AND search identical to chat at dark/dim/light/30/65 %
```

**`dim` was missing from it for as long as it existed.** `VISUAL_CHAT_THEME_OPTIONS` in
`chatTheme.ts` lists dark/dim/light at slider positions 0/50/100 — three NAMED themes with a switch
in the UI — and the probe covered both ends plus two arbitrary custom points, skipping the one in the
middle that the product actually ships a control for. **A theme with a name and no check is the
easiest kind to break.** Measured now: `dim` resolves to `#171718`, and voice and search match the
chat route there as they do everywhere else.

`voicebright.mjs` replaces a line that named `voice.mjs` for this. That file is an earlier
diagnostic — it prints button and glyph counts and asserts nothing about brightness — so the entry
described a check that was never running. The probe now reads eleven tokens off each route's themed
root and compares them to the chat route, which is what the line always claimed.

Every probe above passes as of §7 closing. `final.mjs` also reports two console errors, a 500 and a
401 from the mock's own API; they pre-date the adoption and its assertion is `lucideLeft`, which is
empty.

**Pin reduced motion in any new probe**, or every glyph reads as still:

```js
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
```

### The last zero was mistimed, not unreachable

`Spinner` read 0 for this entire programme — 12 in source, never once seen. The suggested fix was
network interception, and it needed none: **typing into the composer and pressing Enter renders two
spinners at 400ms, and they are gone by 900ms.** Every sample this probe took was at 4200ms.

The component was rendering the whole time, in a window narrower than the settle delay. **A transient
component is not unreachable, it is mistimed** — and a probe that samples once, after everything has
settled, is built to miss exactly this class of thing.

The walk now samples DURING the action, at 350/700/1400ms. `Spinner` 0 → 1, `Textarea` 1 → 2, 39% →
40%.

**All four zeros are closed.** Every adopted component in this chat has now been rendered at least
once for a probe, which was not true of any of them a few iterations ago.

### The state map is now exhausted

Every MOUNT gate it named has been tested, and the last two paid: the project file preview and the
scheduled-task create dialog, both one click **inside** the project page rather than off it. The
seeded project has carried a file and a task since two iterations ago, for exactly this.

135 → **140**, `IconButton` 45 → 49, `Button` 41 → 42.

The two that did not pay, and why, so nobody re-tests them:

- **`isChatFilesModalMounted`** was already captured — `View files in chat` had been in the walk since
  the menu was enumerated, and adds 1.
- **`isPinnedSectionOpen` starts OPEN.** Clicking `Pinned` collapses the section: 50 → 49. The gate
  was never shut, and a walk that clicked it would have measured *less*.

That leaves `isMultiInterface`'s six behind a sign-in wall and `isRecentFilesOpen`'s two behind
`display: none`. **The map is out of reachable gates**, which is a different thing from the number
being finished — it means the next gain needs a fixture (a test account) rather than another path.

### `isMultiInterface` — the ceiling is the probes', not the app's

The largest single gate in the state map is `isMultiInterface`, six controls including the whole
system prompt panel. "A prop no click reaches" was the right answer to the wrong question — the real
one is whether any REACHABLE route sets it.

It comes from `MultiChatContainer`: `isMultiInterface={interfaces.length > 1}`. Three places mount
that component, and none is reachable by a probe on this dev server:

| | |
|---|---|
| `App.tsx` `/` | inside `<ProtectedRoute>` — the same sign-in wall the production build put round the chat |
| `HeroSection` | lazy-loaded into the landing page hero |
| `Dashboard.tsx` `/playground/chat/llm` | **the file is imported nowhere** — its routes never mount, which is why that URL renders the landing page |

So those six controls are a ceiling **for the measurement**, not for the product: reachable by a
signed-in user, unreachable by an unauthenticated probe. Worth stating precisely, because "unreachable"
and "unreachable without credentials" call for different responses — the first is a dead end, the
second is a fixture problem someone with a test account could solve.

Incidental, and reported rather than acted on: `src/pages/Dashboard.tsx` is referenced by nothing. It
carries route definitions that cannot fire. Not this spec's to remove.

### Three lines of enquiry that closed, and why that is worth writing down

An iteration spent confirming that promising ideas do not work is cheaper than the same iteration
spent by the next person. All three were measured, not reasoned about.

**HOVER buys nothing for this metric.** The message action bars are hover-revealed, so the walk not
hovering looked like an obvious gap. Hovering all three messages changed the counts by zero: the
controls are in the DOM at rest and hidden by `opacity`, and `querySelectorAll` finds them either
way. 41 icon buttons before, 41 after, 26 visible in both. **A visibility gate is not a mount gate**,
and only the second kind moves this number.

**The system prompt panel is unreachable on these routes.** Its trigger is missing at rest, missing
after the composer reveal row, and missing with the demo off. The gate is `{isMultiInterface && (` —
the prop the state map already flagged, and four of its six controls are this panel. **No click
reaches a prop.**

**Turning the demo off LOSES coverage.** With `xeno_chat_demo=off` the empty state renders 2 Buttons
and 11 IconButtons against 6 and 41 with the thread. The seeded demo is the richest state on the
route, not an obstacle to a purer one — worth knowing before someone disables it to "measure the real
empty chat".

### Selection is a different capability from opening

The catalog's action row stayed dark through several iterations of opening things. Its `Select all`,
`primary` New and solid-danger Delete are gated on `selectedCount > 0` — and a row only toggles
selection while the catalog is in selecting MODE, so the path is three deep: **open, switch mode, pick
a row.** Opening the panel was never going to be enough, however many panels were opened.

`['Open all chats and tasks', 'Select', 'Seeded conversation 1']` — the row is nameable because the
walk seeds `chatHistory_playground` itself.

126 → **135**, the second-largest jump in this programme, and **`MenuItem` is now fully covered**:
29 → 41 distinct against 38 in source, zero unmeasured. Selection mode swaps every row's leading glyph
for a checkbox and brings its per-row menu into reach, so one path lit up a component wholesale.

The general lesson is worth more than the points: **a walk models the moves it was built from.** This
one modelled *navigation*, so it could open anything and select nothing, and every unrendered control
behind a selection looked like an unreachable surface. Asking what KIND of move is missing beat
looking for another door.

### Asking the source which states hide the controls

The gap moved inside `ChatWithLLM`, where there are no more doors to open. Rather than hunt, ask the
file: for each unrendered `<Button>` and `<IconButton>`, what is the nearest enclosing conditional?

```
6  isMultiInterface          3  isFullScreenImageMounted   2  isProjectFilePreviewMounted
4  isSystemPromptOpen        2  isRecentFilesOpen          2  isProjectScheduledWhenMounted
3  isChatFilesModalMounted   2  isChatsCatalogOpen         2  isPinnedSectionOpen
```

That is the map the last several iterations were feeling around for. `isMultiInterface` is a PROP —
six controls no click will ever reach on this route, which is worth knowing before trying.

Two states added, both triggers verified present at rest first: the chats catalog and the fullscreen
image viewer. 123 → 126, `IconButton` 42 → 45.

**The catalog opens and its action row does not.** `Select all`, the `primary` New and the
solid-danger Delete are gated on `selectedCount > 0` — a state one level below "the panel is open",
reached by selecting a row rather than by opening anything. Three conversions from this adoption live
there. The walk models paths through surfaces; it does not model *selection*, and that is the next
distinct thing it would have to learn.

### Enumerating a menu instead of guessing its paths

`More chat options` holds **twelve** items and the walk was using one. Listing them cost a single
run: View files in chat · Pin chat · Archive · Delete · Theme · Temporary chat · Customize · Search
messages · Settings · New chat · Upload a file · Recent.

Five were worth adding, and each was checked to land before being believed. The result is honest and
smaller than the count suggests — 121 → 123, `Button` 39 → 41:

| path | new library components |
|---|---|
| `Delete` | +2 — the confirm dialog, whose `danger emphasis="solid"` button had never rendered for a probe |
| `View files in chat` | +1 |
| `Customize` · `Theme` | 0 — reached, and thin: `ChatCustomizePage` holds 1 Button, and the theme menu is hand-written |

**Those surfaces are reached, not missing.** `Upload a file` and `Recent` were left out deliberately:
they lead to the `hidden` attach panel.

The remaining gap is now concentrated where it always was — `ChatWithLLM` itself, 36 Buttons and 64
IconButtons in source, behind states inside the main chat rather than behind doors off it.

### Splitting the suite — measured, not guessed

At 432s the suite had passed the point where it gets run every iteration, and **a gate nobody runs is
worth less than a slower one that is**. Timing each probe individually rather than estimating:

```
probe-coverage      148s     probe-light-ink       36s     probe-tab-order        8s
probe-voicebright   112s     probe-project-set.    24s     probe-adopted-metr.    8s
                             probe-control-fill    21s     probe-dead-norm.       8s
                             probe-invisible-f.    21s     probe-variant-shapes   9s
                             probe-open-findings   21s     probe-small-targets    9s
                                                           probe-voice-thumb      7s
                                                           probe-dead-hooks       1s
```

**Two probes are 60% of the wall clock.** Everything else together is ~137s. The estimate that
prompted this put coverage at ~90s and suspected `probe-light-ink` — it is 148s, and light-ink at 36s
was never the problem.

`probe:chat` → 172s, twelve probes. `probe:chat:full` → everything.

The two held back are not less important; they guard a different KIND of thing. The fast gate catches
correctness regressions, which is what an iteration breaks by accident. **Coverage and theme parity
move only when someone changes the walk, the tokens or the bridge** — deliberate acts, and the full
run belongs to those commits. The runner prints how many were held back, so the split is visible in
its own output rather than remembered.

### A path whose first step is missing looks exactly like an unreachable surface

The chat settings MODAL — distinct from the settings PAGE, two surfaces whose controls both say
"Settings" — holds `ChatSkillsWorkspace`, the densest single surface in this chat at 8 Buttons.

Adding `['Chat settings']` as a path bought **zero**, which read as the modal having nothing new. The
control does not exist in the DOM at rest: it is a `MenuItem` inside `More chat options`. **A path
whose first step is absent fails silently and identically to a surface that is genuinely unreachable
— both move the total by nothing.**

`['More chat options', 'Settings', 'Skills']` bought **seventeen**: 104 → 121, 41% → 47%, the largest
single jump in this programme. `MenuItem` 19 → 29 and `TextInput` 2 → 4 alongside.

The lesson is the same shape as §5.4c and worth stating as its sibling: **check the first step
resolves before concluding anything from a path that bought nothing.**

### A flat walk cannot reach a section inside a page

`Switch` — the one real switch in the chat, "Generate memory from chats" — read 0, and the walk was
already opening the page it lives on. The problem was ORDER, not reach: the steps were a flat list of
single clicks, so `Settings` opened the global settings page and by the time a later `Memory` click
came round, the page had been replaced by whatever the walk clicked next.

Clicking `Memory` immediately after `Settings` renders it. **Opening a page is not the same as
visiting it**, and a sequence of single clicks quietly asserts that every surface is reachable from
the top.

The walk is a list of PATHS now — `['Settings', 'Memory']` — clicked in immediate succession, so a
nested surface is reached while its parent is still open. `Switch` 0 → 1, 38% → 39%.

### Two components had never been rendered by any probe. Now they have

`Textarea` and `ListRow` both read 0 for this entire programme. Both are now non-zero, and neither
needed anything clever:

- **`Textarea`** renders only when a code block is in EDIT mode. One click on the demo thread's own
  code block — and the probe had to learn to match on `title` as well as `aria-label`, because that
  control is titled `Edit code` and labelled nothing. **A walk that only reads `aria-label` is blind
  to every titled control in the app.**
- **`ListRow`** renders through `projectChats.map(...)`, so a project with **no conversations** shows
  the rail and none of its rows. One seeded conversation carrying `projectId` was the whole fix.

37% → 38%, `Button` 30 → 32 alongside them.

Two zeros left, and they are the honest kind: `Spinner` (12 in source) needs a loading state that
does not exist while a mock answers instantly, and `Switch` (4) lives in Customize, GlobalSettings and
SkillsWorkspace — pages the walk opens but whose sections it does not.

### The identity collapse was worth exactly one

The `distinct` identity was the label alone, which merges two different source sites that share a
word — a Cancel in the delete dialog and a Cancel in project settings counted once. That was the last
known way the figure could be wrong, and it undercounts, so it was worth closing.

Identity is now the nearest `data-` landmark plus the label. The chat is dense with those hooks
marking dialogs and pages — it is what the twenty unreferenced anchors in `probe-dead-hooks` ARE —
so the nearest one names the surface a control sits on.

**It moved the number by one.** 93 → 94, stable across three runs, `Button` 29 → 30. The collapse
that seemed like the main remaining source of error was costing a single entry.

That is a result rather than a wasted pass, and the conclusion it licenses is the useful part: **the
remaining 63% is not measurement error.** Refining the identity further is not where it lives. What
is left is genuinely unrendered surfaces — the zeros, and the two thirds of `Button` and `IconButton`
that sit behind states the walk has not reached.

### The number went DOWN, and that was the correction

40% → **36%**, because the total had been taking the larger of `at once` and `distinct` per
component, and `at once` counts instances.

**41 icon buttons render on the chat route from 23 distinct labels.** One `<IconButton>` inside a
`.map()` renders once per message, so instances measure what is on screen while this table asks how
many of the 255 SOURCE occurrences have ever been seen. A repeat is one of those. The larger-of-two
rule was flattering every component with a list in it.

The premise it corrects is one this loop had been carrying forward: that the union *undercounts*
IconButton. It does not — the max *overcounts* it. Both numbers stay in the table, and only `distinct`
feeds the total.

24 → 27 → 31 → 32 → 39 → 40 → **36**, and the drop is the most trustworthy movement in that list.

### A selector map is an assumption about another repo

`probe-coverage` reported `MessageBubble` 0 rendered for this entire programme, while a demo thread
with three message bubbles sat on screen. The component's class is `.xeno-message`; the probe looked
for `.xeno-message-bubble`. **A typo in the selector map and a genuine coverage gap both print a
zero**, and nothing distinguishes them in the output.

It is now fully covered — 3 rendered, 0 unmeasured — and was the whole time.

The guard that makes this class of bug impossible: every entry in `SELECTOR` is checked against the
library's own stylesheets before the browser opens, and a class no rule mentions **exits non-zero**
rather than reporting a gap. It caught the typo on the first run.

Worth generalising: the map is an assumption about a second repo's internals, written from the
component's NAME rather than read from its source. Three of the remaining zeros — `Textarea`,
`Switch`, `ListRow` — now carry a little more weight, because the guard says their classes are at
least real.

### Re-checking what was left open

`scripts/probe-open-findings.mjs` asks the repo and the running chat whether the §9 findings deferred
to the owner are still true. An open finding decays two ways and both are silent: someone fixes it and
nobody closes the entry, or it gets worse and nobody notices because it was already "known".

All four confirmed open, and one number had already moved — 15 blue utility classes were 14, because
the message editor's focus ring was themed. That is the check earning its place: the count is live
rather than copied forward.

| | |
|---|---|
| no variant member for `--chat-overlay` / `--chat-control-strong` | library declares neither; closing it is palette, and `DESIGN_SYSTEM.md` is LOCKED |
| the blue cluster in `SearchChatInterface` | 14 utility classes + 11 literal `rgb()` |
| three `data-` state hooks read by nothing | `data-percentage`, `data-rail-open`, `data-active-tool` |
| surface tokens colliding | dark `elevated==control` · dim none · light `elevated==canvas` |

It is a gate, unlike `probe-coverage`: its numbers move only when a finding changes state, which is
precisely what someone should be told about.

### Reaching a branch the mock has no data for — without editing the source

§6 offers "temporarily feed a branch, screenshot, **revert**" for surfaces the mock cannot render.
For the project settings dialog — the surface with the most decided controls — that turned out to be
unnecessary, and the reason generalises: **`chatProjects` seeds itself from localStorage**
(`chatProjects_playground`), so the branch can be fed from outside the app. No source edit, nothing
to revert, no chance of a fixture surviving into a commit.

**Check for a persisted state before editing source to reach a branch.** Several of this chat's
states persist, and a persisted state is one a probe can write.

Measured, in dark and light, identically: `Button` 2, `IconButton` 1, `TextInput` 1, `Textarea` 1,
6 hand-written, **0 height drift**. First browser measurement of that dialog.

Two things it cost, both worth keeping:

- **A hittability check has to match the click method.** The first version rejected `Projects` for
  `pointer-events: none` — but it dispatches a synthetic `el.click()`, which bypasses
  `pointer-events` entirely. Several rail controls rest that way until hovered. A real
  `page.click()` needs the strict check; the two are not interchangeable, and reusing the wrong one
  reported "could not reach" for a control that had just been clicked successfully.
- **Writing a probe that selects a hook changes the dead-hook count.** Adding this one took
  `data-project-settings-dialog` out of the unreferenced-anchor list, 20 → 19, and `probe:chat`
  caught it. The anchors exist to be selected; one finally was. That is the convention paying off,
  not a regression — but the expectation still has to move in the same commit.

### How much do the probes actually see? — a quarter

`npm run probe:chat` reporting green is easy to read as "the chat is verified". It is not, and
`scripts/probe-coverage.mjs` puts a number on the difference: **255 adopted components in the source,
140 rendered across the three routes — 55%.**

24% → 27% → **31%**, and the last jump came from asking a better question. Chasing the aggregate got
three points at a time; asking **where the 74 unrendered Buttons actually live** got four in one step,
and the answer was not "scattered":

| file | Button | IconButton |
|---|---|---|
| ChatWithLLM | 36 | 64 |
| ChatSkillsWorkspace | 8 | 1 |
| CodeBlockWithHeader | 6 | 1 |
| ChatScheduledPage · ChatGlobalSettingsPage · ChatArtifactsPage | 5 each | 0–2 |
| ChatShareModal · ChatSettingsModal | 4 · 3 | 1 each |

**Whole pages.** Artifacts, Scheduled, Settings and Customize are boolean-state pages behind the
history sidebar holding 16 Buttons between them, and they need no seeding at all — the sidebar open
and one click each. `Button` went 8 → 16 and `TextInput` rendered for the first time in this whole
programme, 0 → 2.

Naming where a blind spot lives is what made it reachable. Two iterations of localStorage seeding
bought three points; one afternoon of `grep -c "<Button" per file` bought four.

One key looked feedable and is not. `xeno-chat-projects-page-open` persists, but the app WRITES it on
mount, so a seeded `'true'` reads back `'false'` — the page is opened by clicking instead. **A seed
that silently does nothing is worse than no seed**, because the probe still reports a number and the
number now implies coverage it did not buy. Check the value survives the mount before trusting it.

**The history store keys off a different id.** `chatHistory_playground`, not `chatHistory_default` —
it uses `sharedInterfaceId = 'playground'`, a constant deliberately separate from the `interfaceId`
prop that names `recentFiles_*`, so all interfaces share one history. Two stores, two ids, and the
difference is invisible unless you read both.

**A gain can be real and still not move the total.** `probe-coverage` takes the MAX across the three
routes, so seeding conversations and opening a row menu — `MenuItem` 2 → 7 on the chat route, five
components no probe had ever rendered — leaves the reported number unchanged, because search already
showed 12. The per-route gain is real; the total understates it. Read the table, not just the
percentage.

Two smaller things that cost time here, both recorded in the probe:

- **It was not counting the resting state at all.** The walk clicked before it measured, so the first
  click's cost (a panel covers the composer controls behind it) was counted and its benefit was not.
- **69 vs 70 was noise**, chased as if it were the history seed's doing. Disabling the seed gave 69
  too. The tab-stop lesson applies to every count here: re-run before building a story on a delta of
  one.

**Three ways a seed goes quietly empty**, all met here, and worth checking in this order before
writing one:

| | |
|---|---|
| the app **overwrites** the key on mount | `xeno-chat-projects-page-open` — read it back after load |
| the value is **filtered** on read | `recentFiles_*` drops anything older than seven days, so a baked-in timestamp ages out; compute `Date.now()` inside the page |
| the key is **already set** to what you wanted | `xeno_chat_mock` and `xeno_chat_demo` are ON by default in dev — seeding them buys exactly nothing, and they are what produces the demo thread the probes have been measuring all along |

The last one is worth dwelling on: two keys that looked like the highest-leverage things to feed were
already feeding everything the probes see. **A seed's value is the delta it buys, and the delta can be
zero for a key that works perfectly.**

`recentFiles_default` seeds cleanly and mounts 2–4 more components, but its panel opens from a hover
tool rail that a synthetic click does not reach, so its contents stay unmeasured. Recorded rather
than left as an open question someone re-derives.

That number is a FLOOR and it conflates three things, which is why it is not a gate:

1. **unreachable without data** — projects, artifacts, scheduled tasks, a share link, attachments,
   the customize page. The mock has none, so those controls are decided in source and will never
   render for a probe. **This is the genuine blind spot.**
2. **not mounted until interaction** — and this turned out to be **near zero**. Driving the
   composer's reveal row and then the model tray left the library count flat at 45 while the total
   visible button count *fell*: 94 → 91 → 83. Those panels are built from the controls that stayed
   hand-written, and opening one covers the composer controls behind it.
3. **transient** — every `Spinner` counts 0 because nothing is loading at the moment of the count.
4. ~~**mutually exclusive branches of one surface**~~ — **this was the AGGREGATION, not the code.**
   The share dialog's two states cannot both exist at once, so a per-step MAX can only ever see one.
   Counting the UNION of what has ever rendered across the walk sees both. `Button` went 17 → 29 the
   moment the question changed from "how many at once" to "how many distinct".

   Neither aggregation is the truth alone, so the probe now reports **both**: `IconButton` reads 49
   at once against 41 distinct, because icon buttons repeat their labels and a union keyed on the
   accessible name collapses them. Reporting one number would have been cleaner and worse.
5. **deliberately hidden markup** — and this is the one worth knowing about. The attach / recent-files
   panel is `<div className="relative hidden">`: `display: none` unconditionally, kept for a tool rail
   this route does not use. **No hover and no click can open it** — two iterations were spent trying
   before reading the markup would have answered it in a minute.

   One of the `TextInput`s converted during this adoption lives inside that block. The conversion is
   correct and the control is unreachable, which is most of why the table reads `TextInput` 12 in
   source and 0 rendered. **A control can be decided, converted, correct, and still never render.**

**So the gap is (1) and (3), and (1) dominates.** The blind spot is the data-dependent branches, not
closed menus — worth knowing before anyone spends an afternoon automating clicks to close it.

Finding that out needed one diagnostic first: the earlier attempt clicked nothing because
`[data-chat-model-trigger]` rests at `visibility: hidden; pointer-events: none` inside the collapsed
reveal row, and `[aria-label*="Attach"]` measures 0×0. **A click that lands on nothing looks exactly
like a click that changes nothing** — check the element is hittable before concluding from a null
result.

**It is a gate now, and the shape is the point: a floor on the COUNT, not the percentage.**

It was kept out of the runner because its number moves whenever a component is added, and a gate that
fires on healthy change teaches people to ignore gates. That reasoning was right about the
PERCENTAGE — add twenty Buttons to the source and it falls with nothing broken. It was wrong about
the count, which only falls when a surface the walk used to reach stops being reachable. That is
exactly a regression and nothing else.

Floor 134 against 140 measured: enough headroom that a transient miss does not cry wolf, tight enough
that losing a whole page shows. **The floor rises with the baseline** — a floor left behind drifts
into meaninglessness, still green while a third of the walk has quietly stopped working. The runner
gained a `{ min: n }` form for it, and both directions were verified before it was trusted: green at
the floor, exit 1 above it, with the failure naming the delta rather than just reporting movement.

### Are the numbers stable? — three full runs, diffed

Finding one flaky number is a reason to distrust the rest, not to assume they are fine. The whole
suite was run three times and the verdict lines diffed: **byte-identical on all eleven, every run.**

So the asserted numbers are stable, and the one unstable number — the tab-stop count — is a printed
DIAGNOSTIC that nothing asserts on. That distinction is the useful part: a probe can print something
noisy without the gate becoming noisy, and here it does, by accident rather than design.

**It takes about four minutes** (237–246s measured), because it drives a real browser eleven times.
§0 asks for it every iteration and that is a real cost, so the runner prints its own elapsed time.
`npm run test:chat` is the seconds-long gate; this is the slow one. Knowing which is which is what
stops someone quietly dropping the slow one.

### Which probes need a theme loop, and which do not — measured, not assumed

Three probes stayed single-theme on the reasoning that metrics, target size and tab order are not
theme-dependent. That is a hypothesis, and this section is mostly a list of hypotheses about probes
that turned out wrong, so it was measured: same page, dark against light, plus three runs of the same
theme to separate a theme effect from noise.

| | Result |
|---|---|
| adopted controls (45) and height drift (0) | **identical** across dark and light, and across three runs — no theme loop needed |
| sub-24px targets (1) | **identical** likewise |
| tab-stop COUNT | **unstable within one theme**: 72, 68, 68 |

The count varies because the chat has transient controls — the diff named `Scroll to bottom`, which
is present only when the message list is scrolled up. **It is not a theme effect and it is not a
baseline.** `probe-chat.mjs` asserts on the number of keyboard-unreachable targets, which held at 0
through every run; that was the right choice and it was not made deliberately.

**Correcting an earlier claim in this repo:** commit messages here quote "67 stops → 68" and "68 →
69" as evidence that a conversion added exactly one stop. The stops WERE added — a `<button>` where a
`<div onClick>` had been — but the numbers were noise around a real change, not measurement of it.
The unreachable count is what proved those.

### The probe is the thing most likely to be wrong

Five probes in this loop reported a defect that did not exist, and one had two bugs at once. That is
a higher failure rate than the code they were measuring. **Check a probe's own logic before believing
its answer**, and when its number moves, suspect the probe first.

The five, because they rhyme and the next one will too:

| It reported | It was actually |
|---|---|
| 10 unreachable click targets | 1 disclosure header; children INHERIT `cursor: pointer`, so its title, count line and favicon stack each counted |
| another unreachable target | a drag container whose real click target is a focusable child already in the tab order |
| a control 2px off its size token | a reveal at `scale(0.92)`; `getBoundingClientRect` includes transforms, `offsetHeight` does not |
| a `mono` field failing to draw mono | a font stack authored `'Inter'` and computed `"Inter"` — same list, different quoting |
| every dead normalisation rule as live | the class always appears once, inside the SELECTOR naming it; the check compared against zero |
| zero control fills on `--chat-control` | authored `#262626` compared against computed `rgb(38, 38, 38)` — **the row above this one, made again by the person who wrote it**, two iterations later |
| the sidebar hover pill dead on all six rows | the sidebar was CLOSED: it rests at `left: -260px` with `pointerEvents: 'none'`, so `el.hover()` reached nothing. §5.4d again — opening it is the probe |
| zero `.xeno-icon-hosts` rules loaded, so the icon motion "was never wired" | the walk read `if (r.cssRules) { recurse; continue }`, and in current Chrome **every** `CSSStyleRule` has a `cssRules` list for nesting — an empty one, which is truthy. It skipped every style rule in the document. Read `selectorText` FIRST, then recurse |
| every icon animation dead on hover | **headless Chrome defaults to `prefers-reduced-motion: reduce`**, and the chat correctly honours it. Measured three ways: unset → 0 animations, `reduce` → 0, `no-preference` → 2. Emulate the media feature explicitly or the probe measures the browser's accessibility default and calls it a regression |

Nine now, and the last three came from a single report — *"the icons lost their hover animation"* — where
**nothing was broken**. The pill travels, lands within 0.4px of its row, and all six glyphs animate. Three
consecutive measurements said otherwise, each for its own reason, and each looked like a confirmed bug
until the next layer was checked. Two of them were failures to make the app do the thing before measuring
whether it did the thing; the third was reading the CSSOM with a walk that skipped what it was counting.

The one worth dwelling on is still the sixth: it is the normalisation trap listed directly
above it, repeated by the person who had just written that table. **Knowing a trap is not the same as
not falling into it** — which is the argument for the probes being committed with their reasons
inline rather than trusted to memory.

The shape is always the same: **a probe reads what is rendered, and what is rendered contains intent
and accident in the same value.** Narrow the question until the two cannot both satisfy it. And
normalise before comparing anything — authored hex against computed `rgb()`, single-quoted font
stacks against double-quoted computed ones, a token read with `getPropertyValue` against the same
token resolved on an element.

One more, since it cost an hour: **a rule can be in the built bundle, match the element, and still
not apply.** The dev server on :5183 serves a stale copy of the library CSS, so a NEW library rule
has to be verified against the elements preview on :5223. `matches()` returning true while the rule
is absent from the page's CSSOM is what that looks like.

### Seeing it

Photograph the control if you can reach it. Many cannot be reached: the mock has **no projects, no
artifacts, no scheduled tasks, no share link, and no updates**, and several branches need
`isMultiInterface`. For those, the honest options are

- temporarily feed the branch, screenshot, **revert** (used for the carousel and the system-prompt
  panel — both reverted, both confirmed clean afterwards), or
- say plainly in the commit that it was not photographed.

**Do not describe an unverified conversion as verified.**

---

## 7. Fields — after the buttons

**20 `<input>`** → `TextInput`, **14 `<textarea>`** → `Textarea`. **Done: 0 still to decide** — 22
decided, 4 excluded as pickers and sliders. `node scripts/spec-status.mjs` reports the three buckets
the way it does for §3's buttons; a raw tag count cannot tell a decided field from an untouched one.

Nine converted. The rest stay hand-written, and the shape of that answer is the finding: almost none
of them was blocked by anything local.

Same rules, plus:

- `TextInput` is a flex row: the wrapper `<label className="relative">`, the absolutely-positioned
  magnifier and the `pl-8` that dodged it all go. The glyph becomes `leadingIcon`.
- `.xeno-textarea` is 15px; most of these are 13px. That is a real change to body text in forms —
  make it deliberately, in its own commit.
- **A field's type comes from its size token, not from the page.** It is easy to read `.xeno-input`
  and conclude otherwise — the WRAPPER sets no font-size, so the box looks type-neutral — but
  `.xeno-input-field` is `font-size: var(--xeno-font)`, and `--xeno-font` is welded to `--xeno-h`:
  28px comes with 13px text, 36px with 14px. So picking the right HEIGHT retypes the field unless
  the source happened to match the step. `fontSize` is the door out (added for the two project
  dialogs, whose 13px fields would otherwise have outgrown their own 13px labels). Two fields were
  converted before that door existed and moved 12px → 13px with the box; that is recorded, not
  re-litigated.
- **Two shapes the component cannot take, and both recur:** a field on a raised panel
  (`.xeno-input` hard-codes `background: var(--xeno-canvas)`), and a field that is bare inside a box
  it does not own — a filled wrapper, an animating bar, a row that also hosts a clear button.
  `TextInput` is box-and-field together, so adopting it there means replacing the box that carries
  the fill. Most of the chat's remaining fields fail on one of these two, not on anything local.
- **Do not convert:** the two composer textareas (refs, auto-grow, bespoke motion), the two
  `type="file"` pickers (hidden), the two `type="range"` inputs (the theme slider — `TextInput` is
  not a range).

---

## 8. Do not convert — decided, with reasons

Re-deciding these costs more than it saves.

| | Why |
|---|---|
| 3 of the 4 `role="switch"` | text pills — a switch by role, a button by shape |
| 5 gradient scroll overlays | invisible hit areas holding a hint glyph, not buttons |
| the remaining `<svg>` | mock HTML strings, a framer-animated path, a `<defs>` filter, the agent cursor |
| the assistant turn | its design is "no bubble" — the component has three lines of CSS to offer for ~350 lines of JSX and a pinned-bar rule it cannot express |
| the XENO wordmark button | a brand mark in the display face; the component would impose the control font |
| composer Send and Mic | already repainted wholesale by `[data-composer-send-button]` `!important` rules — the variants would have nothing to decide |
| top-bar Temporary and Theme | wait together for a `Button` with a rotating-chevron slot; converting one and not the other splits a pair |
| `CodeBlock`, `ModelPicker` | incompatible by design, verified: the library's CodeBlock is explicitly un-highlighted, and ModelPicker has no place for the gooey inline tray |

---

## 9. Out of scope — belongs to someone else

- **Two chat surface roles the variant set has no member for.** Not a conversion decision — a
  question for whoever owns the design system, and `CLAUDE.md` rule 1 says it is not this repo's to
  answer.

  | Token | What it is | Blocks |
  |---|---|---|
  | `--chat-overlay` | `rgba(0,0,0,0.18)` — a translucent wash that darkens what is behind it, not a colour | 6 controls: the 4 mode tabs, the inline model + provider chips, the model trigger's minimal form |
  | `--chat-control-strong` | a second, brighter control fill (`#404040` dark / `#e5e5e5` light) | 8 sites, incl. the model tray rows, where it is the *selected* fill |

  Every fill the library offers is opaque and there is exactly one control fill, so a chip resting on
  the wash would come out sitting ON the composer instead of IN it, and a two-weight selection would
  flatten to one. **Do not substitute `--xeno-control` for either.** That exact substitution has been
  made once already in this project — `--chat-hover`, a pointer signal, used as a rest fill — and it
  would have shipped a chat where every chip looked permanently hovered.

- **The chat marks selection with a RING as often as with a fill, and only one of those is a
  variant.** Eight ringed states across the chat: an inset hairline — usually `--chat-muted` at 50–55%
  — with no background at all. The settings dialog's four preference groups, the catalog row's Select
  all, and the project settings tablist with its narrow twin. `quiet[data-selection=on]` says chosen
  by FILLING and dropping the outline, which is the opposite move, and it would put a `--chat-control`
  plate where these deliberately have none. `outline` is a rest state at full ink whose brightening is
  a hover, not a selection.

  **Closed in the library.** `ToggleButton` carries `selectionStyle="ring"` now: the box stays empty
  and the border comes up to `--xeno-muted`. It is a presentation of the same axis rather than a
  variant, because these eight sit on three different variants and none of them wants a different
  KIND of button — so it also undoes what a variant already said, putting `quiet`'s outline back and
  closing the toggle's clip-path flood. Measured in the elements preview, seven checks green.

  The two findings did share one fix, and the fill's precondition is now written where the fill is
  declared. **The eight call sites are still hand-written, and measuring them showed the door does not
  fit any of them yet** — which is worth knowing before someone tries:

  - ~~**Two are tabs.**~~ **Door cut, and the blocker moved.** The project settings tablist and its
    narrow twin run on `useTabs`, so they carry `role="tab"` and `aria-selected` where `ToggleButton`
    carries `role="button"` and `aria-pressed` — a tab is not a toggle. The library has **`<Tab>`**
    now, a tab ROW for a tablist the product drives, and this pair is why it exists: `<Tabs>` owns the
    selection, the keys and the PANEL, and these are two tablists over ONE shared panel, which two
    `<Tabs>` instances cannot express — they would mint two panels and two id namespaces and fight for
    the selection. `<Tab>` spreads `tabProps` last so the hook still wins, and carries
    `selectionStyle="ring"` under the same attribute name `Button` and `ToggleButton` use.

    **What blocks them now is METRICS, and §3 says a swap and a resize are two edits.** Measured, they
    are off the scale in two DIFFERENT directions, so there is no one token that adopts both:

    | | height | padding | font | nearest steps |
    |---|---|---|---|---|
    | wide tablist | 32 | 8 | 11.5 | `md` 32/12/14 · `xs` 24/8/12 |
    | narrow twin | 36 | 12 | 12 | `lg` 36/14/14 · `md` 32/12/14 |

    Each borrows a height from one step and a padding from another and undercuts both on type. The
    wide list also WRAPS, so adopting at `md` re-flows it to a different number of rows — a visible
    change to a settings dialog, and one to take deliberately rather than as a side effect.
  - **One is not a selection.** The catalog's Select all is an action, and its ring is `--chat-accent`
    over a `--chat-control` fill — a filled control wearing an accent ring, where `ring` means an
    empty box with a muted border. Wrong on both counts.
  - ~~**Four are tiles.**~~ **One is a tile, and the count was the error.** Re-measured: `chat-settings-row`
    has exactly **one** call site. The four was `personas.map` INSTANCES counted as sites — the same
    conflation the coverage metric made and corrected once already (§6). It is a real shape — a 68px
    card stacking a name over a two-line clamped description, selected by brightening the border and
    filling with `--chat-surface` — and the library has nothing like it: its `Tile` is a square glyph
    box, `Card` is a container, `ListRow` is a row. **But a component invented from one example fits
    one example.** Not cut. If a second site appears, the shape is written down here ready.

  A presentation without a component to wear it was still progress — it is the fill's precondition that
  was doing the damage, and that is stated. The tabs now have their component and want a size decision;
  the tile wants a second call site before it earns one.

- **`quiet[data-selection=on]` has a surface precondition, and nothing states it.** It says "chosen"
  by filling with `--xeno-control` and dropping the outline. In the dark theme `--chat-control` and
  `--chat-elevated` are **the same value, `#262626`** — so on an elevated surface the fill is
  invisible and removing the border takes away the only edge the chosen control had. Converted and
  reverted once on the settings dialog's four preference groups, where it rendered the selected
  segment as a bare bold word between two outlined neighbours.

  **Closed: the precondition is stated, and there is now a presentation without one.** The comment on
  `quiet[data-selection=on]` says in the stylesheet what had only been learned by hitting it, and
  `selectionStyle="ring"` is the way out for a control whose surface collapses the fill.

  It reads correctly on `--chat-canvas` (`#0a0a0a`) and `--chat-surface` (`#171717`), which is why
  the artifacts, scheduled, settings-page and skills families all converted cleanly. **Check what the
  control sits on before using it — and note that "check the surface" is not a sufficient rule.** The
  theme menu's System chip is rendered into TWO panels, one `--chat-elevated` and one
  `--chat-canvas`. Converting the copy that would read and not its twin gives one chip a filled
  selection and the other a hover-tinted one, for a control the user reads as a single thing. A
  selection that depends on the surface cannot serve a control that appears on two of them. The design system's own answer for a selection on an elevated
  surface — brighten the outline, as `prefBtn` does — has no variant: `outline` is a normal border at
  full ink, and its brightening is a hover.

- **A converted `secondary` fills one step darker than the hand-written button it replaces, and it
  is not the component's fault.** `ChatWithLLM.tsx` carries a legacy theme-normalisation block that
  force-maps old hardcoded hex fills onto the chat tokens. Two of its rules name the SAME selector:

  ```css
  .chat-themed [class*="bg-[var(--chat-control)]"] { background-color: var(--chat-control) !important; }
  .chat-themed [class*="bg-[var(--chat-control)]"] { background-color: var(--chat-control-strong) !important; }
  ```

  Same specificity, so the later one wins and every hand-written `bg-[var(--chat-control)]` in the
  chat actually paints `--chat-control-strong` — **#404040, not #262626**. Measured: the settings
  dialog's selected tab reads `rgb(64, 64, 64)`; the `secondary` Buttons converted from the same
  class read `rgb(38, 38, 38)`, because the rule is keyed on a Tailwind class substring and a library
  component has no such class in its `class` attribute.

  So every `secondary` conversion so far — Save, Add, Create skill, Import skill, Connect, Install —
  was one step darker than what it replaced. **Do not "fix" this at a call site.**

  **Closed: the duplicate was copy-paste, and the block itself says so.** Every other line in it is
  either a legacy hex mapped onto a token or a token mapped to itself. `--chat-control` →
  `--chat-control-strong` was the only cross-mapping in the whole block, and it was the duplicated
  one — the second selector had been pasted alongside `[class*="bg-[var(--chat-control-strong)]"]`,
  which is that token's own identity rule. Removed.

  Measured on the empty chat before and after, with `scripts/probe-control-fill.mjs`: 11 elements
  carry the class, 10 painted `rgb(64, 64, 64)` and now paint `rgb(38, 38, 38)`, which is what their
  class says and what the converted `secondary` Buttons already painted. The eleventh is a selected
  `.chat-mode-tab`, which a **more specific** rule maps to `--chat-control-strong` on purpose — the
  cross-mapping still happens exactly where it was meant to, and nowhere else.

- **`primary` is unusable in the chat, and the bridge is why.** It paints from
  `--xeno-chrome-btn-primary-bg` / `-fg`, which the two chrome files declare on `:root`. A custom
  property computes where it is DECLARED, so those resolve against the library's own base tokens
  before `.chat-themed` has said anything — and children inherit the computed value. Measured inside
  the chat: a `primary` button is **#2b2b2b on #d8d8de**, the library's palette, where every other
  variant correctly reads the chat's. The bridge maps eleven base tokens and no chrome ones.

  **Closed: the bridge carries the two chrome tokens now.** The diagnosis needed one more step than
  §9 first recorded. `chrome-separated.css` declares on `:root` and `chrome-unified.css` under
  `[data-chrome='unified']` — nothing in the chat sets that attribute, so the chat was getting the
  SEPARATED reading, resolved on `:root` against the library's own palette. That is exactly the
  measured #2b2b2b on #d8d8de, and it is why bridging the eleven base tokens had no effect: the
  bridge was working and the value never passed through it.

  Two lines in `chat-theme.css` re-declare the same references in a scope where `--xeno-text` and
  `--xeno-on-accent` are already the chat's. Measured after: `primary` paints **#fafafa on #0a0a0a**
  in dark, **#0a0a0a on #ffffff** in light, and follows both custom stops (#161617, #21242a) — a
  bridge that did not track the theme would not be a bridge.

  The formula is the unified construction's, restated rather than chosen: the chat's eleven inverted
  controls are `--chat-text` on `--chat-canvas` already, and `--chat-on-accent` IS `--chat-canvas` —
  measured, both #0a0a0a. If the chat should wear the separated reading instead, `chat-theme.css` is
  the one place that changes.

  **Three converted, on the first pass after the door opened.** The three Cancel/confirm pairs where
  only the Cancel could convert are whole: the two message-editor Saves and the voice route's. The
  fill is an exact swap — `--chat-accent` and `--chat-text` are the same value at every theme stop
  (dark #fafafa, light #0a0a0a, 65% #f5f6f8), measured. Rendered `primary` at both sizes: 28px and
  32px, #fafafa on #0a0a0a in dark and #0a0a0a on #ffffff in light.

  Two changes were made deliberately rather than carried over. The hover was `opacity-90`, which
  fades the LABEL along with the fill; the variant lays a `--chat-hover` tint over the fill and leaves
  the ink at full strength. And the voice route's Save filled `--chat-muted` — a grey — where the
  other three fill accent. Three sites agreeing and one not is the one being corrected.

  **Five more on the next pass, found by re-reading the reasons rather than the code.** Two of them
  still said "unusable until the bridge carries the chrome tokens", which had been true when written
  and was not any more — a reason that outlives its cause reads exactly like a live one. Create
  project, the catalog's New, the scheduled Add, project settings' Save changes, and the share
  dialog's Done.

  Two of the five were already `<Button variant="ghost">` with the fill painted over them through an
  inline `style` — the prop `ButtonProps` **omits deliberately**, which passed only because the build
  strips types without checking them. A variant that has to be overridden to look right is the wrong
  variant.

  **That turned out to be a seam worth grepping, not a coincidence.** Every library component in the
  chat carrying a `style` prop was a variant reproducing another variant by hand: two `ghost lg`
  buttons and a `ghost md` `IconButton` painting `--chat-control` with text ink, which is `secondary`
  word for word, and the share dialog's Delete link — a `ghost` with an inset hairline, which is
  `danger` at rest, exactly.

  Measured on the running chat: `danger` rests at no fill, `rgb(163,163,163)` ink and a hairline, and
  on hover turns ink AND border `rgb(239,68,68)`; `secondary` rests at `rgb(38,38,38)` with
  `rgb(250,250,250)` ink. The hover is the correction the last one gains — a button labelled *Delete
  link* used to brighten to neutral, and now says what it does when you reach for it.

  **The `style` prop is where a wrong variant choice hides.** It is closed in the types and open at
  runtime, so nothing failed and nothing said so.

- ~~**Hand-written controls whose shape already IS a variant.**~~ **Swept, and clean — the last
  seam.** Four of these were caught hiding behind an inline `style`, each a `ghost` overridden into
  `secondary` or `danger`, so the same shapes written as plain Tailwind were the obvious last place.

  `scripts/probe-variant-shapes.mjs` renders one of each variant into the live chat and compares
  every hand-written button's resting fill / ink / border against them — both sides measured in the
  same document, so nothing needs normalising. **One hit, and it is correctly hand-written.**

  The hit is the model trigger, and WHY it matched is the useful part: `index.css` pins its whole chip
  family with `!important`, so what the probe measured was the normalisation block's paint, not the
  control's own intent. A computed shape cannot tell those apart. Its recorded reason names three
  independent blockers and all three still hold — the gooey inline tray the library's `ModelPicker`
  has no place for, that `!important` family which no size token would survive, and a face four
  conditional glyphs deep.

  Two things the probe now says out loud, because both would mislead silently: `quiet` and `danger`
  compute **identically** at rest — transparent fill, muted ink, a hairline — and differ only on
  hover, so it reports every matching variant rather than the first; and a match is a weak signal,
  since resting shape knows nothing of hover, focus or a disabled branch.

- **Each theme collapses a DIFFERENT pair of surface tokens, and only `dim` collapses none.**
  Measured on all three, which is the point — `probe-invisible-fills` had been running on whatever
  theme the browser started in, and a collision is exactly the kind of thing that is theme-specific:

  | | canvas | surface | elevated | control | control-strong |
  |---|---|---|---|---|---|
  | dark | `#0a0a0a` | `#171717` | **`#262626`** | **`#262626`** | `#404040` |
  | dim | `#171718` | `#1b1b1d` | `#212124` | `#2a2a2e` | `#36363b` |
  | light | **`#ffffff`** | `#fafafa` | **`#ffffff`** | `#f5f5f5` | `#e5e5e5` |

  Controls whose fill matches the surface beneath them: **dark 11, dim 4, light 8.**

  The dark collision is the one already recorded — `elevated` == `control`, which is what gives
  `quiet[data-selection=on]` its unstated precondition. **The light one is different and was not
  recorded: `elevated` == `canvas`**, so a floating panel has no fill contrast with the page it
  floats over. The model tray and the attach panel rely entirely on their border and shadow there.

  That may well be intended — white-on-white with a shadow is a real idiom — but it had never been
  measured, and it means the `--chat-elevated` token does no work in light. **A design-system
  question, same family as the two above: which token should differ is not an agent's call.**

- **`data-` hooks: 82 declared, 59 referenced, 23 not — and the number is the wrong question.**
  Seam (d), swept with `scripts/probe-dead-hooks.mjs`, which searches every `.tsx`, `.css`, `.mjs`
  and `scripts/` file before calling anything unreferenced. §5.5 exists because four hooks were lost
  during conversions, and a sweep in the other direction fails the same way.

  The 23 split into two kinds that want **opposite** answers, which one number hides:

  - **20 are ANCHORS** — `data-chat-share-dialog=""`, the dialog family, the preview family: constants
    written once, there to BE selected. Unreferenced is their normal state. The ten chat tests are
    built on exactly this affordance in the composer, so deleting the rest would remove the thing that
    made the composer testable. **Keep.**
  - **3 are STATE** — `data-percentage`, `data-rail-open`, `data-active-tool`: recomputed on every
    render and read by nothing. A DOM write per render, claiming to drive something that does not
    exist. Recorded, not deleted; a runtime-built selector string is invisible to any grep, and the
    cost of being wrong here is a broken interaction rather than a stale rule.

    **Closed — and neither answer the finding offered was the right one.** It asked for a consumer or
    a deletion, and all three wanted a third thing:

    - `data-rail-open` and `data-active-tool` mirror `LEGACY_HOVER_TOOL_RAIL`, which is a hardcoded
      `false`. They are not unread state, they are **constants**: `'false'` and `''` on every render
      there has ever been, and the 86-line branch beside them has never rendered. The flag carries a
      `: boolean` annotation for the sole purpose of stopping TypeScript narrowing it to `false` and
      calling that branch dead — someone parked a feature deliberately. Stripping its state mirrors
      leaves them to be written again by whoever un-parks it. **Whether the legacy rail goes at all is
      a product call, and it is a bigger one than this finding.**
    - `data-percentage` is an **ANCHOR the two buckets could not hold**. It classified as STATE because
      it is written as an expression, but `index * THEME_BRIGHTNESS_STEP` is fixed for the bar carrying
      it — `data-selected` beside it is the state, and it is the one that moves. It is also the only
      way to name a bar in the vocabulary the theme is discussed in: `probe-voicebright` walks five
      stops, and a selector by percentage says which is which where `nth-child` says the eleventh.

    So the finish line moved to where §3 and §7 already had it. A hook may be unread; it may not be
    unread **by accident**. `Unread on purpose` beside a declaration is the hook's `Stays hand-written`,
    `probe-dead-hooks` gained the third bucket to count it, and the gate is now **0 with no reason
    written** rather than 0 unread.

    Two things bit while closing it, both the same shape and both already in §6's table in another
    form. Writing the reasons put the hook NAMES into prose, and the reference count read those
    mentions as consumers — 3 unread became 0, by writing the sentence saying they are unread. **A
    mention in a comment is not a use**; both probes blank comment bodies before counting now. And the
    first attempt put the reason in JSX **attribute** position, where `{/* … */}` parses as a spread —
    §5.4b trap 3, walked into by the person who wrote §5.4b.

  **One was neither, and it is gone.** `data-history-drag-shiftable` was not unused — it was a second
  copy of a live mechanism. The CSS reads the CLASS `history-drag-shiftable`, which the same elements
  already carry; the attribute drove nothing and would read to the next person as the thing the
  transition keys on. A duplicate is worse than an unused hook, which is the same lesson the
  duplicated `!important` selector taught two seams ago.

- ~~**Normalisation rules with nothing left to match.**~~ **Swept: 24 selectors → 11.** The block
  force-maps legacy hardcoded fills onto the chat tokens, keyed on Tailwind class SUBSTRINGS, so every
  conversion that replaced a hand-written control deleted one of those classes and left the rule that
  named it behind. Thirteen selectors named classes that appear **nowhere in any chat file** — ten
  legacy hexes, `text-[#f6b98b]`, `border-white`, `border-[#232021]`.

  Dead weight, and worse than that: **the duplicate that repainted every control fill in the chat was
  found by reading a block whose size implied every line was load-bearing.** A rule matching nothing
  makes the rest look necessary. Removing them also turned up a second duplication —
  `border-[var(--chat-border)]` listed twice in one rule, harmless because both copies agreed, and the
  same copy-paste as the one where they did not.

  `scripts/probe-dead-normalisation.mjs` is the check: it counts what each selector matches on the
  running chat AND greps the class out of the source, because a zero alone cannot tell a dead rule
  from one whose branch the mock never renders. One selector is dormant rather than dead —
  `bg-black/` still has a call site, in a branch that does not render by default — and the probe says
  which is which. **Its first two versions were both wrong**: the regex missed the last selector of
  every rule, and the live/dead column compared against zero when the class always appears once, in
  the selector naming it.

- ~~**Appearance classes surviving a conversion.**~~ **Swept, and clean.** §3.4 says `p-`, `h-`,
  `rounded-`, `bg-` and friends come off when a control is converted, because the component owns its
  box. A static grep finds nothing, but it can only see literal `className` strings — a conditional, a
  shared const or an interpolation hides one completely. `scripts/probe-adopted-metrics.mjs` asks the
  rendered page instead: **45 adopted controls, every one at the height its own `--xeno-h` declares
  and every one at `--xeno-radius-control`.** Nothing survived.

  It reported one drift first, and that was the probe: the composer's voice chevron rests at
  `scale(0.92)` until the microphone is hovered, so 28 × 0.92 = 25.8 read as a control off its size
  token and was a reveal doing its job. It measures `offsetHeight` now. **Third probe false positive
  this session** — after children inheriting `cursor: pointer` and a container with a focusable child
  — and they rhyme: a probe reading rendered geometry cannot tell intent from accident, so the
  question has to be narrowed until it can.

  Two things the axis absorbed: `disabled:opacity-40 disabled:cursor-not-allowed` at two sites is the
  availability axis written out, and measured on the component it is opacity 0.4 with `not-allowed`
  from `disabled` alone. One colour moved on purpose — the share dialog's Done inked
  `--chat-elevated` (#262626), the dialog's own surface, where `primary` inks `--chat-on-accent`
  (#0a0a0a); a light fill wants the deepest ink, and every other inverted control already used canvas.

  The rest are still hand-written, including the composer's Send, which the normalisation block
  repaints with `!important` in both states.

  ~~**And it now has a companion.**~~ **Closed, and it was one job as predicted.** The projects
  header's New project needed both the chrome tokens and the reveal's mirror, and could convert on
  neither alone. `Button` carries `iconReveal="trailing"` now (elements-foundations 3f8d242) and the
  button is `primary sm` with `trailingIcon`.

  The park is negative, which is the idea rather than a sign flip: reflecting a reveal reverses the
  direction the glyph comes FROM, and a positive park would have it arriving from outside the button
  instead of out from under the label. One shared line changed with it — the base transition named
  `padding-left`, so the mirror's `padding-right` would have snapped while the leading one animated.
  A one-sided implementation hides that; the second side is where you find out the first was written
  as a special case.

  Measured in the elements preview with real CDP hover: at rest opacity 0 parked at -22px in a
  clipped box; on hover opacity 1, translate 0, padding-right 12px → 34px while padding-left holds.

  **Closed: the destructive half has its solid reading.** `Button` carries `emphasis="solid"` now
  (elements-foundations 2ed1953), painted from `--xeno-danger` / `--xeno-danger-hover` — base tokens,
  not chrome, so it is one file rather than two and a product's theme reaches it. Both confirms
  converted, and each gave up an inline fill and TWO mouse handlers standing in for a `:hover` rule;
  the catalog's also gave up a literal `#ffffff` that no chat token named, which had been white ink on
  red in light mode where the rest of the chat inverts. Measured in the elements preview: quiet keeps
  no fill and muted ink, solid fills rgb(239,68,68), inks from text and drops its border. In the chat
  the rule is present in the built bundle; :5183 serves stale library CSS, per §6.

  ~~The library's `danger` is the opposite reading~~ — a neutral hairline with
  muted ink that turns red only when reached for. That is the right position for a Delete sitting in
  a row (and three of those converted to it), but not for the confirm INSIDE the dialog that asks. A
  quiet last-chance button is quiet in the wrong place. Neither half is a call site's to improvise.

- ~~**The sort trigger's reveal.**~~ **Closed.** `Button` carries `iconReveal` now: the glyph goes out
  of flow behind the label, the box opens on its left, and both pages converted. Measured on the
  running chat — at rest `opacity: 0` and parked `translate: 22px` right of where it lands; on hover
  `padding-left: 32px`, which is what `hover:pl-8` said by hand. The remaining §9 entries are all
  colour or token questions, and none of them is a component's to answer.

- ~~**A field cannot keep its type.**~~ **Closed.** `TextInput` carries `fontSize` now, and the gap
  was `iconSize`'s exactly one property over — `--xeno-font` is welded to `--xeno-h`, so a 36/13
  dialog field asking for its own height came back retyped to 14px, a pixel larger than the 13px
  label above it. Both project dialogs converted on it. The prop doc names the hazard the override
  carries: it also beats the touch surface, where md and lg go to 16px because iOS Safari zooms a
  focused sub-16px input.

- **`.xeno-input` hard-codes its fill, and that is what most of the chat's fields fail on.** Nine of
  the remaining fifteen sit on `--chat-surface` or `--chat-control` — sidebars, raised dialogs, filled
  wrapper plates — where the component paints `--xeno-canvas` and would sink each of them to #0a0a0a
  inside a lighter panel. It is the same shape as the `primary` finding: a component that decides its
  own background can only be used on the one surface it assumed. A field is the case where it bites
  most, because a field is nearly always ON something.

- **A field component that hard-codes its typography can only be used by a page that agrees.** Three
  instances of one shape turned up in §7, each one property over from the last: `--xeno-font` welded
  to the box step (closed — `TextInput.fontSize`), 15px written flat into `.xeno-textarea` (closed —
  `Textarea.fontSize`), and `font: inherit` leaving no way to state a monospace face. The third is
  the code editor in `CodeBlockWithHeader`, and it is the only field in the chat blocked by type
  rather than fill — its `--chat-canvas` is exactly what the component paints.

  **Closed, and the argument against a third door held.** The answer was not `fontFamily` but a MODE:
  `--xeno-font-mono` had been declared in `fonts.css` beside `--xeno-font-sans` since the beginning
  and was **read by nothing** — a family the system named and kept no promise about. `Textarea mono`
  asks for it by name (elements-foundations 88bcbcd), and the editor converted.

  Measured in the elements preview: default draws the sans stack, `mono` draws the mono stack, the
  size token is untouched. One honest note carried in the probe — the `letter-spacing: normal` that
  ships with the mode measured as a NO-OP there, because a bare `.xeno` host does not push Inter's
  -0.006em into a form control. It is defensive, and it earns its keep where a product sets tracking
  on a container the field sits in.

- **A test that fails on its first line stops describing anything.** `test-chat-send-button-layout`
  sliced the composer out of the source at `{isLoading ?` and the composer-polish pass (3d27aef)
  removed that marker, so it failed at the slice and none of its twelve assertions had run since.
  Six were still true. Three described a chat that had deliberately moved on, and only reading them
  after re-scoping the test showed which:
  - the disabled send state was pinned as `border-white/10 bg-[#161618] text-zinc-600` — literal hex
    and a Tailwind palette name, which cannot follow a light mode or a brightness slider. It is the
    same three tokens now, pinned just as exactly, plus a new assertion that the button carries no
    hard-coded colour at all.
  - the send arrow was pinned by its raw path, `M12 19V5M5 12l7-7 7 7`. It was hand-drawn at stroke 2
    with round caps while every other composer glyph came from the set at 1.75, and it could not
    animate because there was nothing to animate against. It is the set's `ArrowUp` now.
  - the size assertion was named "Send button should be optically smaller than the microphone" and
    now asserts the opposite. Stop, Mic and Send are one box on purpose, through a shared constant a
    sibling test already counts the uses of. **Send being smaller is not a property this chat wants
    any more.**

  The scope is a `<ChatEmptyState>` boundary rather than a conditional, because the failure mode is
  the lesson: a test anchored to an implementation detail deletes itself silently.

  `test-chat-token-counter-layout` was the same marker in the same pass, ending its slice at
  `{isLoading ?`, and its five assertions had been unread just as long. Four were still true. The
  fifth — `counterIndex < modelSelectorIndex`, "Token counter should be left of the model selector" —
  compared two positions in a row that now contains only one of them: the composer-polish pass handed
  `<ChatModelSelector>` to `<ChatEmptyState>` as a render prop, so it draws above the box and the "+"
  control reveals it with the mode tabs. **Left alone it would not have failed loudly; it would have
  compared against -1.** Both halves are pinned now instead of the one comparison — the selector is
  gone from the row, and it is where it went — and the counter's place is stated against the voice
  control, the right-hand group's first member, which did not move.

- ~~**Three tests red since the composer-polish pass.**~~ **Closed — 10/10, KNOWN_RED empty.** The
  third, `test-chat-voice-controls`, is the one that paid for the exercise. Its thumb assertions
  read `h-2.5 w-2.5 rounded-[3px]` and `translate-x-[14px]` as contiguous strings, and 3d27aef had
  split them — `rounded-[3px]` stayed on the base span while the size moved into the branches,
  because the thumb grows when the switch is on.

  Updating the number to 12 would have passed. Measuring it instead found a bug the test had been
  pointing at all along: the track is 28px with a 1px border and 2px of padding, so a 12px thumb's
  runway is 10px. **Both the old 14 and the new 12 overhang the inner edge by 2px** — the thumb
  rested 3px from the left and landed 1px from the right, at rest and after the change. Travel is
  10px now, measured at 3px inset on both ends. The test's own name had said `even inset` since it
  was written.

  The machinery stays with an empty list. A green board with three unread tests in it was worth less
  than a red one.

- **Removing the duplicated rule took away an accident that one control was living on.** The settings
  dialog's own tablist said so in a comment, written before the rule was touched: the dialog is
  `--chat-elevated`, the selected tab filled `--chat-control`, those are the same #262626 in dark, and
  the tab was legible **only** because the duplicate force-mapped it to #404040. Removing the
  duplicate was right and left that tab a bare bold word. It draws a ring now, like the other seven.

  The same removal FIXED the model tray, which is the other half of the story and the reason to
  measure rather than assume. Its rows are `--chat-control` at rest and `--chat-control-strong` when
  selected; the duplicate had been mapping both to #404040, so **selected and unselected were the same
  colour** and only a check glyph told them apart. Measured now: tray #262626, resting rows #262626
  flat against it with their border delineating, selected row #404040.

  `scripts/probe-invisible-fills.mjs` is the check. It reports every control whose fill matches the
  surface beneath it — which is not automatically wrong, since a resting row on a tray is meant to be
  flat. The question it answers is about PAIRS: if a control and its selected twin both appear, the
  selection is invisible.

- **A blue cluster the theme does not reach.** Sweeping for the pattern that produced the disclosure
  defect — a library STYLESHEET adopted while its behaviour was left behind — turned up a different
  kind of borrowing instead: Tailwind's blue palette, in a chat whose own tests assert a monochrome
  reading elsewhere (`test-chat-voice-controls` asserts the voice popover contains no `blue`).

  Counted: **15 blue utility classes** and **11 literal blue `rgb()`/`rgba()` values**, across two
  files. None of them follows the theme, so they hold still through light mode and every brightness
  stop while everything around them moves.

  **One was unambiguous and is fixed.** The message editor's focus ring was `ring-blue-500/25` on the
  same element whose border is `border-[var(--chat-accent)]` — the box had already decided which token
  it uses, and one property had been left behind. It is `ring-[var(--chat-accent)]/25` now.

  **The rest is deliberately not repainted.** The remainder is one coherent surface: the browser-agent
  overlay in `SearchChatInterface` — pulse rings, a cursor badge, a `scroll` chip, an "Agent
  controlling browser" banner and two `Spinner`s overridden through `--xeno-spinner-track` /
  `-edge`. A mode that colours itself is a legitimate design position, and `DESIGN_SYSTEM.md` is the
  visual authority for that call and is **LOCKED**. This is the measurement, not the verdict.

  Worth noting either way: the two spinners use the library's own custom-property door correctly. What
  is passed THROUGH it is a literal, which is a call-site question rather than a component one.

- **Six controls sit below the scale's floor — and the framing was incomplete.** The control scale
  starts at `xs` = 24px; the chat has six squares at 18–20px, each a badge or a hint notched into
  something else, where six pixels of growth is six more pixels of what it sits on being covered.
  `iconSize` reaches the glyph and deliberately not the box: the library's position is that height is
  a surface-level variable, so an 18px control is a size this app has not declared rather than an
  override to write at six call sites. **That position still stands.**

  What was missing is that "below the scale" and "too small" are different claims, and only the second
  is a defect. WCAG 2.2 AA asks for 24×24 CSS px **or** enough spacing that a 24px circle centred on
  the target meets no other target's circle. `scripts/probe-small-targets.mjs` measures both.

  Measured on the empty chat: **one** sub-24px interactive target is reachable — the Recents section
  heading at 73×21.6 — and it **passes on spacing**, nearest neighbour 95.6px. The other five live in
  branches the mock cannot render (attachment chips, the customize page), so the probe says so rather
  than implying they were checked.

- **Some click targets are not keyboard-reachable, and the first count of them was wrong.** Looking
  for the undersized badges turned up their hosts: click boxes written as `<div onClick>` with no
  `role` and no `tabIndex`. The count recorded here was **10**, and that number was inflated — a click
  target's children INHERIT `cursor: pointer`, so one disclosure header containing a title, a count
  line and a favicon stack reported as nine separate targets. `probe-tab-order.mjs` counts outermost
  ones only now. The honest before-figure was **three**, not ten.

  **One is fixed.** The Web Sources header is a `<button>` with `aria-expanded` and `aria-controls`,
  and the reason it is worth naming: the class it wears is `xeno-sources-header`, the library's own,
  and `SourcesDisclosure` renders that same class **on a button**. The stylesheet had been adopted and
  the behaviour left behind — the one kind of borrowing that looks finished and is not. Taking the
  component whole is the eventual answer; it owns the content model too, and this header carries a
  title, a count line and a favicon stack with its own colour logic.

  Measured before and after with real Tab presses: 67 stops → 68, one added where the header sits, and
  distinct unreachable targets 3 → 2.

  **Now zero, and one of the two was never a defect.** The message's attached-file row was a real
  `<div onClick>` that opens the file in the context panel; it is a `<button>` with `text-left`, and
  tab stops went 68 → 69. The other was the probe's own false positive: the history list's rows carry
  `cursor: pointer` on a drag container whose actual click target is a focusable child button. The
  wrapper is not a target, and flagging it reported a defect that was not there.

  So the probe now skips a container holding a focusable descendant — the second false positive of the
  same family as the nesting one, and the second time this count came down by fixing the measurement
  rather than the product. Both corrections are in `probe-tab-order.mjs` with the reason.

- ~~**Panels that are not menus.**~~ **Closed.** Both panels run on `useMenu` + `useGooPill` now and
  their four rows are `MenuItem`s. Measured on the model dropdown: focus lands on the first row when
  it opens, Arrow Up/Down and Home/End walk, Escape closes, and the accordion row keeps the menu alive
  because `expanded` reports `aria-expanded`, which `useMenu` treats as a disclosure rather than a
  choice.

  **What it cost to find:** the rows would not take focus, and the hook was not at fault.
  `transition-all` on a panel that opens by flipping `visible`/`invisible` sweeps `visibility` INTO
  the transition, and Chrome then keeps the panel hidden for longer than a frame — measured, still
  hidden at 16ms and visible by 50. `useMenu` focuses the first row in the commit that opens the menu,
  so it was aiming at a hidden subtree and the focus went nowhere. `transition-[opacity,transform]`
  fixes it and keeps the fade and the scale. **Any panel that hides with `visibility` should name its
  transitioned properties.**

  Escape is not the hook's: it owns the arrows, Home/End and Tab, and hands dismissal back to whoever
  owns the open state. Both panels got the listener every other menu in the chat already had.

- **7 `ReferenceError`s** outside the chat — Office, AudioGeneration, ImageStudio. `npm run
  check:names` lists them with file and line. The fixes need their authors' intent (`smoothStroke`
  has a different signature; `currentEditIndex` does not exist as state). **Report, do not guess.**
- **`chrome-unified.css`** — the Soft construction. A PRESERVED look, so it needs no work; the 11
  shared component stylesheets that still hardcode construction values are emilian's.
- **The send-path DB verification** — blocked on the local API returning 401/500.
- **`DESIGN_SYSTEM.md` §426** says panels "are NOT merged into a single container", which is exactly
  what Soft is. Until an owner writes the paragraph acknowledging a second construction, Soft ships
  against the locked authority. **An agent must not write that paragraph** — `CLAUDE.md` rule 1 says
  the design system is not this repo's to reinterpret.

---

## 10. Done

**All five conditions are met.** They were:

1. `spec-status.mjs` reports **0 buttons and 0 fields still to decide** — every remaining `<button>`
   carrying its `Stays hand-written` reason;
2. `check:names` and `check:jsx-comments` clean for the chat;
3. every probe in §6 passing;
4. the themes reading correctly on all three routes;
5. every remaining hand-written control carrying a comment saying why.

Point 5 was the real finish line. "Everything is a component" was never the goal — **"nothing is
hand-written by accident"** is. Current: 82 `Button`, 94 `IconButton`, 38 `MenuItem`, 12 `Spinner`,
12 `TextInput`, 4 `Switch`, 1 `MessageBubble` adopted; 72 buttons and 21 fields hand-written, each
with its reason; 4 fields excluded as pickers and sliders.

### What "done" does NOT mean

Say these out loud rather than letting a green board imply them.

- **The mock renders a fraction of the chat, and the fraction is now measured: 24%.** No projects,
  artifacts, scheduled tasks, share link, attachments or customize page. 255 adopted components in the
  source, 60 rendered across the three routes (`scripts/probe-coverage.mjs`). Those branches are
  *decided in the source* and *unmeasured in the browser*. **A green `probe:chat` covers a quarter of
  the adopted controls** — see §6 for what that number does and does not include.
- ~~**Most probes measure ONE theme.**~~ **Closed, and the answer was not "loop them all".** Four
  probes compare COLOUR and all four now run dark/dim/light: `probe-voicebright` (plus two custom
  stops), `probe-control-fill`, `probe-invisible-fills` and — last, and the one that most needed it —
  `probe-variant-shapes`. That one matches a hand-written control's painted fill/ink/border against
  what each variant computes to, so a per-theme token collision breaks it in **both** directions: it
  can hide a real match and it can invent one. Its verdict is now two numbers, ALL-THREE against SOME,
  because a control matching in every theme is tracking that variant's tokens while a control matching
  in one is sitting on that theme's collision, and converting the second fixes a theme and breaks two.
  Measured: 1 all-three (the model trigger, already explained), **0 theme-only** — a confirmation, and
  confirmations are results.

  The other three stay single-theme **because that was measured too**, not assumed: §6 ran
  `probe-adopted-metrics`, `probe-small-targets` and `probe-tab-order` dark against light and across
  three same-theme runs, and metrics and target size came back identical. Geometry does not care what
  colour it is. Looping them would have tripled their cost to re-measure a constant — which is the
  more useful half of this entry: **"run everything in every theme" is not rigour, it is untargeted
  cost.** Ask what the probe COMPARES first.
- **A `Stays hand-written` reason is a decision, not a permanent fact.** Two of them outlived the gap
  they described, and read exactly like live ones until the doors in §3.3b were checked against them.

### What remains, and whose it is

| | Owner |
|---|---|
| `--chat-overlay` and `--chat-control-strong` have no variant member; closing it means adding palette | design system — `DESIGN_SYSTEM.md` is **LOCKED** and not this repo's to extend |
| the blue cluster in `SearchChatInterface` (browser-agent overlay): 14 utility classes + 11 literal `rgb()`, none following the theme | design system — a mode that colours itself is a legitimate position, but it is a position someone has to take |
| ~~3 `data-` state hooks recomputed every render and read by nothing~~ **closed** — each carries `Unread on purpose` and the reason it is not read; see §9 | — |
| 7 `ReferenceError`s outside the chat (Office, AudioGeneration, ImageStudio) | out of scope here; reported, not fixed |
| the send-path DB verification | blocked on the local API returning 401/500 |
| `DESIGN_SYSTEM.md` §426 says panels "are NOT merged into a single container", which is what the chat does in two places | a contradiction to report, not to resolve |

### What NOT to re-derive

- The six seams in §9 were swept and are recorded with their measurements. They found things a
  file-by-file read did not; they do not need re-running from scratch, only re-checking if something
  changes.
- The nine probe false positives in §6. Every one of them is a mistake the next probe will make.
- The two open design questions above. They have been re-checked twice and the answer is the same:
  they are not an agent's to close.

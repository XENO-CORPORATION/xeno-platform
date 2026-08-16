# Chat → XENO Elements adoption — the remaining work

**Goal:** every control in the chat interface is either a `@xenosystem/elements-react` component or
hand-written with a reason written next to it.

This file is the working spec for that. It is written to be read by an agent that has **no memory of
the last iteration** — so it never says "continue where you left off". Every section starts by
MEASURING the current state, and the measurement is the source of truth. If this document and the
repo disagree, the repo is right and this document is stale.

---

## 0. Orient — run this first, every time

```bash
cd C:/code-dev/xeno-platform
node scripts/check-undefined-names.mjs src/components/playground/Chat   # must be clean before starting
git status --short                                                      # must be clean before starting
```

If `git status` shows changes you did not make, **stop and report**. Someone else works in this repo.

Then count what is left:

```bash
node scripts/spec-status.mjs
```

That prints the per-file button count, the field count, and what is already adopted. Work the file
with the **smallest non-zero count** first — small files finish, and a finished file is a result.
`ChatWithLLM.tsx` is more than half the total and is worked last.

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

1. `git status` clean, `check:names` clean (§0)
2. Read the buttons in the target file (§2)
3. Convert 3–6 of them by hand (§3)
4. Export any missing `*Decl` from `src/lib/icons.tsx`, wire the imports
5. `node scripts/check-undefined-names.mjs src/components/playground/Chat` — must be clean
6. Sweep dead imports (§4)
7. `npm run build` — must print `✓ built`
8. Verify (§6)
9. Commit, push
10. Stop. The next iteration re-measures.

---

## 2. Reading a file's controls

```bash
node scripts/spec-status.mjs --file ChatSettingsModal
```

Prints every remaining `<button>` in that file with its line, its glyphs, its label, its resolved
class (shared `const` class strings are expanded), and its computed box.

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
| a border and no fill | `quiet` |
| no border, no fill | `ghost` |
| anything reaching for `--chat-danger` | `danger` |

This is not a taste call. If the mapping is unclear, the button is unusual — leave it and say so.

### 3.3 Which size — from the box it already occupies

The control scale is **xs 24 · sm 28 · md 32 · lg 36**, glyphs 15/16/16/18.

- `h-6`→xs, `h-7`→sm, `h-8`→md, `h-9`→lg, `h-10`→lg
- no explicit height: box = glyph px + 2 × padding. `p-1`=4, `p-1.5`=6, `p-2`=8, `p-2.5`=10, `p-3`=12
- pick the nearest step

**Keep the current glyph px with `iconSize`.** A component swap and a resize are two edits; the swap
should not silently be both. `iconSize` exists for exactly this.

### 3.4 What to carry over, and what to drop

| Keep | Drop |
|---|---|
| every prop that is not `className` or `type` | `type="button"` — the component sets it |
| LAYOUT classes: `flex-1`, `w-full`, `min-w-*`, `max-w-*`, `ml-*`, `self-*`, `order-*`, `absolute`, `z-*`, all `sm:`/`md:`/`lg:` | APPEARANCE classes: `p-*`, `h-*`, `w-*` (when square), `rounded-*`, `text-*`, `bg-*`, `border*`, `hover:*`, `transition*` |
| product hooks: `data-*`, `chat-*` class names that CSS or JS targets | `data-*` hooks nothing references — grep first |
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

## 5. The four traps, each of which has already happened

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

```
scratchpad/audit3.mjs      67 hosts, 67 moving, 0 STILL
scratchpad/menusweep.mjs   page errors: none
scratchpad/final.mjs       lucideLeft: []
scratchpad/mixrow.mjs      every row adopted, h 32, r 6px, font 14
scratchpad/lightchat.mjs   no near-white ink except the caption on the dark image
scratchpad/custom.mjs      chat and search identical at 15/30/65/85 %
scratchpad/voice.mjs       voice identical at dark/light/30/65 %
```

**Pin reduced motion in any new probe**, or every glyph reads as still:

```js
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
```

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

**20 `<input>`** → `TextInput`, **14 `<textarea>`** → `Textarea`.

Same rules, plus:

- `TextInput` is a flex row: the wrapper `<label className="relative">`, the absolutely-positioned
  magnifier and the `pl-8` that dodged it all go. The glyph becomes `leadingIcon`.
- `.xeno-textarea` is 15px; most of these are 13px. That is a real change to body text in forms —
  make it deliberately, in its own commit.
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

The chat is finished when:

1. `node scripts/spec-status.mjs` reports **0** hand-written buttons and **0** convertible fields,
   with the §8 exclusions accounted for by name;
2. `npm run check:names` is clean for the chat;
3. every probe in §6 passes;
4. the light theme and two custom brightness stops read correctly on all three routes;
5. every remaining hand-written control has a comment saying why.

Point 5 is the real finish line. "Everything is a component" was never the goal — "nothing is
hand-written by accident" is.

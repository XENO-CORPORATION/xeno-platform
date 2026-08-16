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
npm run test:chat                                                       # must be green before starting
git status --short                                                      # must be clean before starting
```

`test:chat` runs all ten `test-chat-*.mjs` and knows which are already red and why, so a failure it
reports is a failure this iteration caused. It went in after six of the ten were found failing at
once — four of them from conversions that dropped a `data-` hook or moved a `<style>` block out from
under a test that read it. **Green before you start, green before you commit.**

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

**5.4b A `{/* … */}` comment as the first thing inside `{cond && ( … )}` is a syntax error.** It has
happened twice in this loop. `{cond && ( {/* why */} <Button/> )}` is two expressions where one is
allowed, and esbuild says `Expected ")" but found ...`. Put the comment ABOVE the `{cond &&` line, or
above the `return (`. Same for a comment as the sole child of a `return (`. The build gate catches
it, which is why the build gate runs before the commit and not after.

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

  These are the same eight controls that the surface collision below would also catch, and the two
  findings share a fix: a selection that reads on any surface, and a name for the one this chat
  already draws.

- **`quiet[data-selection=on]` has a surface precondition, and nothing states it.** It says "chosen"
  by filling with `--xeno-control` and dropping the outline. In the dark theme `--chat-control` and
  `--chat-elevated` are **the same value, `#262626`** — so on an elevated surface the fill is
  invisible and removing the border takes away the only edge the chosen control had. Converted and
  reverted once on the settings dialog's four preference groups, where it rendered the selected
  segment as a bare bold word between two outlined neighbours.

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
  is one step darker than what it replaced. **Do not "fix" this at a call site.** Either that
  duplicated rule is a mistake and `--chat-control` is right, or the chat means `--chat-control-strong`
  for a filled control and the bridge in `chat-theme.css` should say `--xeno-control: var(--chat-control-strong)`.
  That is one decision for the owner, and it also settles the surface collision above.

- **`primary` is unusable in the chat, and the bridge is why.** It paints from
  `--xeno-chrome-btn-primary-bg` / `-fg`, which the two chrome files declare on `:root`. A custom
  property computes where it is DECLARED, so those resolve against the library's own base tokens
  before `.chat-themed` has said anything — and children inherit the computed value. Measured inside
  the chat: a `primary` button is **#2b2b2b on #d8d8de**, the library's palette, where every other
  variant correctly reads the chat's. The bridge maps eleven base tokens and no chrome ones.

  So an inverted button — a fill with inverted ink — has no variant to convert to. **Eleven controls
  across the chat are filled that way**, most of them `--chat-text` on `--chat-canvas`, which is
  precisely what the Soft construction defines `primary` to be
  (`--xeno-chrome-btn-primary-bg: var(--xeno-text)`). Fixing it means the bridge carrying the chrome
  tokens as well: one more line per token, and the owner's call about which construction the chat
  wears.

  **And it now has a companion.** The projects header's New project is an inverted button that also
  reveals its glyph on the TRAILING edge — the mirror of `iconReveal`, which places the glyph at
  `--xeno-padx` from the left. Three call sites wanted the leading reveal and it went into the
  library; this is the first that wants the other. It is one job with the chrome tokens rather than
  two, because the button cannot convert on either alone.

  **The same gap has a destructive half.** Two dialog confirms are a SOLID `--chat-danger` fill going
  to `--chat-danger-hover`; the library's `danger` is the opposite reading — a neutral hairline with
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
  rather than fill — its `--chat-canvas` is exactly what the component paints. Handing `font-mono`
  through `className` would leave two single-class rules deciding the face on stylesheet order, which
  is the same coin-flip `leading-relaxed` posed against the component's own `line-height`. One call
  site does not justify a third override door; the pattern is what wants deciding, and it is the
  library's to decide.

- **Six controls sit below the scale's floor.** The control scale starts at `xs` = 24px; the chat has
  six squares at 18–20px — the two attachment-chip remove badges, the customize page's "i", and
  three more. Each is a badge or a hint notched into something else, where six pixels of growth is six
  more pixels of what it sits on being covered. `iconSize` reaches the glyph and deliberately not the
  box: the library's position is that height is a surface-level variable, so an 18px control is a
  size this app has not declared rather than an override to write at six call sites.

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

The chat is finished when:

1. `node scripts/spec-status.mjs` reports **0 still to decide** and **0** convertible fields — every
   remaining `<button>` carrying its `Stays hand-written` reason (§0), the §8 list among them;
2. `npm run check:names` is clean for the chat;
3. every probe in §6 passes;
4. the light theme and two custom brightness stops read correctly on all three routes;
5. every remaining hand-written control has a comment saying why.

Point 5 is the real finish line. "Everything is a component" was never the goal — "nothing is
hand-written by accident" is.

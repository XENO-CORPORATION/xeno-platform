# @xenosystem/elements

**The XENO element contract — the source of truth.**

> Status: 🟡 **Phase 1** — schema written, declarations not yet drawn. Not published.

Framework-free, platform-free, zero dependencies. This package is a **contract**, not a component
library — it contains no React, no rendering, and nothing platform-specific. Every renderer on
every platform is an interpretation of what is declared here.

## What lives here

| | |
|---|---|
| `src/schema.ts` | The contract: state axes, signals, transitions, bindings, compatibility |
| `src/elements/` | Element declarations — the glyphs and composites *(Phase 1, in progress)* |
| `src/tokens/` | Design tokens, resolved from `DESIGN_SYSTEM.md` *(Phase 1)* |

## The two properties to preserve

**1. There is no "icon" type.** An icon is the degenerate `ElementDeclaration` — no children,
pure geometry. A button is the compound one. They share one schema and one release path, which is
what makes *"edit one icon"* and *"edit one button"* the identical operation. A refactor that
gives icons their own type has thrown away the reason this repo exists.

**2. A declaration contains data, never code.** No functions, no expressions, no executable
animation. `Binding` is a *description* a renderer interprets. This is an architectural boundary
with a legal edge — see `docs/STATE-MODEL.md` §4.1.

## The state model, briefly

Three orthogonal axes, because a single enum cannot express a disabled toggle that is *on*:

```ts
{ availability: 'enabled' | 'disabled' | 'busy'
  selection:    'off' | 'on' | 'mixed'      // semantic, persists
  interaction:  'idle' | 'engaged' | 'pressed' }  // transient
```

Plus continuous **signals** (`progress` 0…1, `activity`) and momentary **transitions**
(`commit`, `reject`, `toggle`).

`engaged` = hover on pointer devices, **nothing on touch**. Full model:
[`docs/STATE-MODEL.md`](../../docs/STATE-MODEL.md).

## Contract compatibility

`checkCompatibility()` answers the question behind automatic propagation: *may this change reach
a shipped product without that product rebuilding?*

Refinements pass — redrawn geometry, retuned timings, added variants, new elements. Breaks are
refused — a dropped axis, a changed viewBox, a removed element, a renamed id.

It **fails closed**: anything it does not positively understand is a break. A permissive contract
checker is worse than none, because it produces evidence of safety it has not established.

## Never barrel the declarations

`src/index.ts` re-exports the schema — small, tree-shakes cleanly. **Element declarations get
per-element entry points.** A single index importing every element is exactly why `lucide-react`
weighs 2.4 MB, and `lucide-react/dynamic` collapses to an empty chunk in production.

---
Part of [`xeno-elements`](../../README.md). Visual authority:
[`DESIGN_SYSTEM.md`](../../DESIGN_SYSTEM.md) — LOCKED.

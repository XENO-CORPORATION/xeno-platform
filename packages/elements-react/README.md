# @xenosystem/elements-react

**Web + Electron renderer**

> Status: 🔵 **planned** — see [`../../SPEC.md`](../../SPEC.md) §13 for the build order.

Interprets `@xenosystem/elements` declarations as React components and web components.

**Not built yet** — Phase 2. The contract lands first, deliberately (`SPEC.md` §13).

## When it is built, it must

1. **Honour every declared axis.** Silently ignoring one produces an element that looks
   interactive and isn't — the worst failure in the set.
2. **Never invent state.** No `pressed` binding in the declaration means pressed looks like idle.
3. **Map input modalities** per `docs/STATE-MODEL.md` §3 — including the **agent** row, or
   agent-driven UI diverges from what a human would have seen.
4. **Be visually indistinguishable** from every other renderer given the same declaration. Testable, and tested.
5. **Add nothing.** No renderer-local colours, timings or easing.

## Hard constraints

- **CSS-first, 0 kb runtime.** Axes become `data-*` attributes; bindings become CSS custom
  properties and transitions. This diverges from the 2026 norm (@animateicons, LivelyIcons,
  Itshover all build on `motion/react`) because XENO elements must run inside **sandboxed
  iframes** and survive **web export**, where a JS animation runtime is weight in every sandbox
  and a dependency that cannot be removed later.
- **`motion` is an opt-in entry point only** (`/motion`), for genuinely orchestrated cases —
  multi-step morphs, physics. ~4.6 kb with `m` + `LazyMotion` vs 34 kb naive. **Never a
  dependency of the base renderer.**
- **No barrel.** Per-element entry points, `sideEffects: false`. A single index importing
  everything is why `lucide-react` is 2.4 MB — and `lucide-react/dynamic` collapses to an empty
  chunk in production builds.
- **Base UI is an implementation detail here**, used for composite behaviour and accessibility.
  It is never exposed as the system's foundation. (Radix stalled after the WorkOS acquisition;
  Base UI reached v1.0 in Dec 2025 with full-time MUI engineering.)
- **Components are generated**, never hand-written. Editing one to fix a glyph means the
  declaration is wrong.

---
Part of [`xeno-elements`](../../README.md). Visual authority: [`DESIGN_SYSTEM.md`](../../DESIGN_SYSTEM.md) — LOCKED.

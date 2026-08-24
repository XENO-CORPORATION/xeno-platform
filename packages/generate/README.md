# @xenosystem/generate

**Declarations → per-platform artifacts**

> Status: 🔵 **planned** — see [`../../SPEC.md`](../../SPEC.md) §13 for the build order.

Turns `@xenosystem/elements` declarations into artifacts for each runtime — the Style
Dictionary model, generalised past tokens to geometry and state machines.

**Not built yet** — Phase 2.

## Pipeline

```
Figma / XENO Canvas → SVGO (30–70% reduction) → declaration generator → @xenosystem/elements → CI
                                                                              │
                                    ┌─────────────────────────────────────────┤
                                    ▼                    ▼                    ▼
                             elements-react       XenoElementsKit      xenosystem-elements
                                  (npm)              (SPM)                  (Maven)
```

Swift cannot be an npm package, which is why renderers ship on each runtime's native channel
rather than pretending to be siblings in one scope.

## Rules

- **Never hand-author a renderer component.** 300 hand-maintained animated components will rot.
- The generator is the only writer of generated output; generated files are marked as such and
  are not edited by hand or by an agent.

---
Part of [`xeno-elements`](../../README.md). Visual authority: [`DESIGN_SYSTEM.md`](../../DESIGN_SYSTEM.md) — LOCKED.

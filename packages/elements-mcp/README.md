# @xenosystem/elements-mcp

**Agent discovery over the element contract**

> Status: 🔵 **planned** — see [`../../SPEC.md`](../../SPEC.md) §13 for the build order.

An MCP server exposing `@xenosystem/elements` to coding agents: semantic search, contract
lookup, state introspection.

**Not built yet** — Phase 2+.

## The differentiator

Icon MCP servers exist (Better-icons indexes 150+ libraries and 200k+ icons; shadcn CLI v4 ships
`shadcn/skills` giving agents component and API context). Serving glyph names is table stakes.

**XENO's serves contracts and states.** An agent should be able to ask *which axes does this
element honour*, *what does this binding do*, *may this change propagate* — not merely find an
icon called "merge". That is the same property that makes XENO panels agent-addressable: an agent
integrates with **the element**, once, everywhere it appears.

---
Part of [`xeno-elements`](../../README.md). Visual authority: [`DESIGN_SYSTEM.md`](../../DESIGN_SYSTEM.md) — LOCKED.

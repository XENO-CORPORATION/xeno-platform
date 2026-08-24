# @xenosystem/preview

**Dev-only State Playground** — the running surface that proves the pipeline end to end.

> Not published. `private: true`. This exists so a capability is never merely *claimed*
> (SPEC §14.4): every element you see is drawn by `<XenoElement>` from its declaration alone.

```bash
npm run dev -w @xenosystem/preview     # → http://localhost:5251
```

Renders all 48 declarations through `@xenosystem/elements-react`, resolving every
`@xenosystem/*` package to its **source** (edit a declaration, the interpreter, or the
renderer and the page updates with no build step). Drag **Size** / **Stroke**; click a
**stateful** element (bookmark) to toggle its `selection` axis — outline ↔ filled, straight
from the data.

Nothing here is authored by hand: no SVG, no per-icon component. The glyph is `decl`.

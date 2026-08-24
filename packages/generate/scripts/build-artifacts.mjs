/**
 * Build the web artifacts for the pack: one SVG per element + a manifest.
 *
 *   npm run artifacts   (from packages/generate)
 *
 * Reads the declarations straight from the `elements` package SOURCE (Node ≥22 strips the TS types),
 * renders each with the shared core, and writes them under `artifacts/` (gitignored — regenerate on
 * demand). The renderer has NO runtime import from the contract package, so no build step is needed.
 *
 * GENERATED OUTPUT — do not hand-edit the files this writes. Fix the declaration or the renderer.
 */
import { readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
// Renderer comes from the BUILT package (real .js all the way down — Node's type-stripping does not
// remap a `.js` specifier to a `.ts` sibling, so the source graph is not Node-loadable). The `artifacts`
// npm script builds first. Declarations, by contrast, load from SOURCE below: each carries only a
// type-only import that Node strips, so there is nothing extensionless left to resolve.
import { renderSvg, buildManifest } from '../dist/index.js'

const ELEMENTS = new URL('../../elements/src/elements/', import.meta.url)
const OUT = fileURLToPath(new URL('../artifacts/', import.meta.url))
const SVG_DIR = `${OUT}svg/`

const files = readdirSync(fileURLToPath(ELEMENTS))
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .sort()

const decls = []
for (const f of files) {
  const mod = await import(new URL(f, ELEMENTS).href)
  decls.push(mod.default)
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(SVG_DIR, { recursive: true })

for (const d of decls) {
  const name = d.id.replace(/^xeno\./, '')
  writeFileSync(`${SVG_DIR}${name}.svg`, `${renderSvg(d)}\n`)
}
writeFileSync(`${OUT}manifest.json`, `${JSON.stringify(buildManifest(decls), null, 2)}\n`)

console.log(`generate: wrote ${decls.length} SVGs + manifest.json → ${OUT}`)

/*
 * The guard checks that every declaration on disk actually LOADED — the failure it exists to catch is
 * a module that throws on import, or a file the filter silently skipped, leaving the pack short a
 * glyph. It compares against the file count rather than a hard-coded 48, which would otherwise have to
 * be edited by hand on every glyph added, and it sets a non-zero exit code: a `console.error` alone
 * still reported success to whatever ran `npm run artifacts`, which is exactly how a build loses a
 * glyph and ships anyway.
 */
if (decls.length !== files.length) {
  console.error(
    `generate: expected ${files.length} declarations (one per source file), got ${decls.length}`,
  )
  process.exitCode = 1
}

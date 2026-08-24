/**
 * One-time import: @xenosystem/foundry workbench markup → real ElementDeclaration files.
 *
 * Reads the foundry glyph data (inner SVG markup for a 0 0 24 24 box) and emits one
 * `src/elements/<name>.ts` per glyph, geometry expressed in the primitive vocabulary
 * (RectPrimitive / PathPrimitive). Deterministic: same input → same output. Run:
 *
 *   node --no-warnings packages/elements/scripts/import-glyphs.mjs
 *
 * The foundry lives on its own branch; this reads it from the sibling worktree by path. The emitted
 * declarations are the source of truth thereafter — edit them, not the workbench.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import svgpath from 'svgpath'

const FOUNDRY = 'C:/code-dev/xeno-elements/packages/foundry/src/icons.data.ts'
const OUT = fileURLToPath(new URL('../src/elements/', import.meta.url))
mkdirSync(OUT, { recursive: true })

const src = readFileSync(FOUNDRY, 'utf8')

// ── Parse the foundry ICONS entries ────────────────────────────────────────
const ICON_RE =
  /id:\s*'([^']+)',\s*category:\s*'([^']+)',\s*label:\s*'([^']+)',\s*tags:\s*\[([^\]]*)\],\s*markup:\s*'([^']*)'/g

const num = (v) => (v === undefined ? undefined : parseFloat(v))
const attr = (s, name) => {
  const m = s.match(new RegExp(`${name}="([^"]*)"`))
  return m ? m[1] : undefined
}
const isSolid = (s) => attr(s, 'fill') === 'currentColor'

/**
 * Apply an SVG `transform="translate(tx ty) scale(sx sy)"` to a path `d`, baking coords.
 *
 * Arguments are separated by whitespace OR a comma — the spec allows both, and most editors emit
 * `translate(2,3)`. Matching only whitespace meant a comma form did not match at all, so `bake` applied
 * whatever it DID recognise and silently dropped the rest, writing the glyph out at the wrong
 * coordinates with no error anywhere. Anything still unrecognised now throws rather than being
 * half-applied: an importer that quietly mis-bakes is worse than one that stops.
 */
const NUM = String.raw`[-+]?[\d.]+(?:e[-+]?\d+)?`
const SEP = String.raw`(?:\s*,\s*|\s+)`

function bake(d, transform) {
  if (!transform) return d
  let p = svgpath(d)
  const sc = transform.match(new RegExp(String.raw`scale\(\s*(${NUM})(?:${SEP}(${NUM}))?\s*\)`))
  const tr = transform.match(new RegExp(String.raw`translate\(\s*(${NUM})${SEP}(${NUM})\s*\)`))

  const rest = transform.replace(/scale\([^)]*\)|translate\([^)]*\)/g, '').trim()
  if (rest) throw new Error(`import-glyphs: unsupported transform ${JSON.stringify(transform)}`)
  if (!sc && !tr) throw new Error(`import-glyphs: unparsable transform ${JSON.stringify(transform)}`)

  // SVG `translate(t) scale(s)` = T·S ⇒ scale first, then translate.
  if (sc) p = p.scale(parseFloat(sc[1]), sc[2] !== undefined ? parseFloat(sc[2]) : undefined)
  if (tr) p = p.translate(parseFloat(tr[1]), parseFloat(tr[2]))
  return p.round(3).toString()
}

/** Parse inner markup → Primitive[] in document order. */
function toPrimitives(markup) {
  const prims = []
  const TAG_RE = /<g\b([^>]*)>([\s\S]*?)<\/g>|<rect\b([^>]*?)\/?>|<path\b([^>]*?)\/?>/g
  let m
  while ((m = TAG_RE.exec(markup)) !== null) {
    if (m[1] !== undefined) {
      // <g attrs>inner</g> — inherit fill, bake transform into inner paths.
      const gAttrs = m[1]
      const inner = m[2]
      const solid = isSolid(gAttrs)
      const transform = attr(gAttrs, 'transform')
      const INNER = /<path\b([^>]*?)\/?>/g
      let pm
      while ((pm = INNER.exec(inner)) !== null) {
        prims.push(pathPrim(pm[1], solid, transform))
      }
    } else if (m[3] !== undefined) {
      prims.push(rectPrim(m[3]))
    } else if (m[4] !== undefined) {
      prims.push(pathPrim(m[4], undefined, undefined))
    }
  }
  return prims
}

function rectPrim(a) {
  const p = { kind: 'rect', x: num(attr(a, 'x')), y: num(attr(a, 'y')), w: num(attr(a, 'width')), h: num(attr(a, 'height')) }
  const rx = num(attr(a, 'rx'))
  if (rx !== undefined) p.rx = rx
  if (isSolid(a)) p.fill = 'foreground'
  return p
}

function pathPrim(a, inheritedSolid, transform) {
  const d = bake(attr(a, 'd'), transform)
  const p = { kind: 'path', d }
  const solid = inheritedSolid !== undefined ? inheritedSolid : isSolid(a)
  if (solid) p.fill = 'foreground'
  const fr = attr(a, 'fill-rule')
  if (fr) p.fillRule = fr
  return p
}

// ── Serialise ──────────────────────────────────────────────────────────────
const pascal = (id) => id.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase())
const primTs = (p) => {
  if (p.kind === 'rect') {
    let s = `{ kind: 'rect', x: ${p.x}, y: ${p.y}, w: ${p.w}, h: ${p.h}`
    if (p.rx !== undefined) s += `, rx: ${p.rx}`
    if (p.fill) s += `, fill: '${p.fill}'`
    return s + ' }'
  }
  let s = `{ kind: 'path', d: '${p.d}'`
  if (p.fill) s += `, fill: '${p.fill}'`
  if (p.fillRule) s += `, fillRule: '${p.fillRule}'`
  return s + ' }'
}

let count = 0
const names = []
let m
while ((m = ICON_RE.exec(src)) !== null) {
  const [, id, , label, tagsRaw, markup] = m
  const tags = tagsRaw
    .split(',')
    .map((t) => t.trim().replace(/^'|'$/g, ''))
    .filter(Boolean)
  const prims = toPrimitives(markup)
  const name = pascal(id)
  names.push({ id, name })
  const body =
    `import type { ElementDeclaration } from '../schema'\n\n` +
    `/**\n` +
    ` * \`xeno.${id}\` — ${label}. A degenerate element (pure geometry, no children).\n` +
    ` * Imported from the foundry workbench; the declaration is the source of truth — edit here.\n` +
    ` */\n` +
    `export const ${name}: ElementDeclaration = {\n` +
    `  id: 'xeno.${id}',\n` +
    `  kind: 'icon',\n` +
    `  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },\n` +
    `  geometry: {\n` +
    `    base: [\n` +
    prims.map((p) => `      ${primTs(p)},`).join('\n') +
    `\n    ],\n` +
    `  },\n` +
    `  bindings: [],\n` +
    `  a11y: { role: 'img', label: '${label}' },\n` +
    `  meta: { tags: [${tags.map((t) => `'${t}'`).join(', ')}], since: '0.1.0' },\n` +
    `}\n\n` +
    `export default ${name}\n`
  writeFileSync(`${OUT}${id}.ts`, body)
  count++
}

console.log(`Imported ${count} glyphs → ${OUT}`)
if (count !== 48) console.error(`WARNING: expected 48, got ${count}`)

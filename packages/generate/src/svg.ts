/**
 * SVG-string serializer: one dialect of the shared {@link interpret} Scene. Turns a declaration into
 * a self-contained `<svg>` string — the artifact the build writes to disk, the foundry previews, and
 * the reference for what "visually indistinguishable" means on the web (SPEC §6).
 *
 * All the drawing DECISIONS (variant selection, token→paint, fail-closed guards) live in
 * {@link ./scene.ts}; this file only spells the resolved Scene as SVG markup.
 */
import type { ElementDeclaration } from '@xenosystem/elements/schema'
import { interpret, type Scene, type SceneOptions, type ShapeNode } from './scene.js'

export type RenderOptions = SceneOptions

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Paint attributes for one shape. An outline part (no `fill`) inherits the root's
 * `fill:none; stroke:currentColor`, so we emit nothing. A solid part is painted and explicitly
 * un-stroked, so its ink is crisp instead of haloed by the outline stroke.
 */
const paintAttrs = (fill: string | undefined): string =>
  fill === undefined ? '' : ` fill="${fill}" stroke="none"`

// Each shape carries a stable `xeno-part` class + `data-part` index (its position in the geometry),
// so a stylesheet can animate an icon's INDIVIDUAL parts — the hook for representative icon motion.
const shapeSvg = (s: ShapeNode, i: number, morph: boolean): string => {
  const part = ` class="xeno-part" data-part="${i}"`
  // A morphable path carries its own `d` a SECOND time, as a custom property. The attribute stays the
  // fallback (and stays authoritative where CSS `d` is unsupported); the property is what a stylesheet
  // can interpolate, because a custom property changing is a computed-value change and `d` transitions.
  // The quotes are written as entities on purpose: React escapes apostrophes inside a style attribute
  // and this serializer does not, and the two renderers are held to byte-for-byte parity (SPEC §6). One
  // of them had to give, and the entity is what both agree on.
  const morphD = morph && s.kind === 'path' ? ` style="--part-d:path(&#x27;${esc(s.d)}&#x27;)"` : ''
  if (s.kind === 'rect') {
    const rx = s.rx !== undefined ? ` rx="${s.rx}"` : ''
    return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}"${rx}${paintAttrs(s.fill)}${part}/>`
  }
  const fillRule = s.fillRule ? ` fill-rule="${s.fillRule}"` : ''
  // `d` is escaped like every other attribute value. It has never needed it — no shipped glyph has a
  // quote in its path data — but it was the one place this serializer was fail-OPEN, in a pipeline
  // whose whole point is that it is not: `interpret` throws on a non-finite coordinate and on a fill
  // that is not a token, and then this let an arbitrary string through into markup unchecked.
  return `<path d="${esc(s.d)}"${fillRule}${paintAttrs(s.fill)}${part}${morphD}/>`
}

/** Serialize a resolved {@link Scene} to an SVG string. */
export const sceneToSvg = (scene: Scene): string => {
  const data = Object.entries(scene.data)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('')
  const className = scene.className ? ` class="${esc(scene.className)}"` : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.size}" height="${scene.size}" ` +
    `viewBox="${scene.viewBox}" fill="none" stroke="currentColor" ` +
    `stroke-width="${scene.strokeWidth}" stroke-linecap="butt" stroke-linejoin="round" ` +
    `role="${esc(scene.role)}" aria-label="${esc(scene.label)}" data-glyph="${esc(scene.glyph)}"` +
    `${scene.morph ? ' data-morph="on"' : ''}${data}${className}>` +
    scene.shapes.map((s, i) => shapeSvg(s, i, scene.morph)).join('') +
    `</svg>`
  )
}

/**
 * Interpret a declaration into an SVG string. The root carries the outline defaults plus one
 * `data-<axis>` attribute for every axis the element declares — the CSS-first seam a stylesheet
 * targets to drive state transitions with zero JS. Degenerate icons (no axes) get none.
 */
export const renderSvg = (decl: ElementDeclaration, opts: RenderOptions = {}): string =>
  sceneToSvg(interpret(decl, opts))

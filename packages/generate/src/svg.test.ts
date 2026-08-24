import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import type { ElementDeclaration } from '@xenosystem/elements/schema'
import { renderSvg } from './svg'

/**
 * Proves the renderer core over the REAL declarations plus a couple of adversarial fixtures. The
 * headline test is the axis proof: a stateful bookmark rendered from pure data changes its markup
 * with its `selection` state — the Phase-1 exit criterion (SPEC §13) in miniature.
 */

const dir = fileURLToPath(new URL('../../elements/src/elements', import.meta.url))
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .sort()

const declarations: { id: string; decl: ElementDeclaration }[] = []
for (const f of files) {
  const base = f.replace(/\.ts$/, '')
  const mod = (await import(`../../elements/src/elements/${base}.ts`)) as { default: ElementDeclaration }
  declarations.push({ id: mod.default.id, decl: mod.default })
}
const byId = (id: string): ElementDeclaration => {
  const found = declarations.find((d) => d.id === id)
  if (!found) throw new Error(`fixture missing: ${id}`)
  return found.decl
}

const fakeRect = (over: Partial<{ x: number; fill: string }>): ElementDeclaration => ({
  id: 'xeno.fixture',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: { base: [{ kind: 'rect', x: over.x ?? 1, y: 1, w: 2, h: 2, ...(over.fill ? { fill: over.fill } : {}) }] },
  bindings: [],
  a11y: { role: 'img', label: 'Fixture' },
})

describe('renderSvg — every real declaration', () => {
  for (const { id, decl } of declarations) {
    it(`${id} emits well-formed, colourless SVG`, () => {
      const svg = renderSvg(decl)
      expect(svg.startsWith('<svg')).toBe(true)
      expect(svg.endsWith('</svg>')).toBe(true)
      expect(svg).toContain(`viewBox="${decl.contract.viewBox}"`)
      expect(svg).toContain('stroke="currentColor"')
      expect(svg).toContain(`aria-label="${decl.a11y.label}"`)
      expect(svg).toContain(`data-glyph="${id.replace(/^xeno\./, '')}"`)
      expect(svg).not.toContain('NaN')
      expect(svg).not.toContain('undefined')
      // Monochrome: no literal colour ever reaches the markup.
      expect(svg).not.toMatch(/#[0-9a-f]{3,8}\b/i)
      expect(svg).not.toMatch(/\brgba?\(/i)
    })
  }
})

describe('renderSvg — paint & structure', () => {
  it('solid parts are filled with currentColor and un-stroked (menu = 3 bars)', () => {
    const svg = renderSvg(byId('xeno.menu'))
    expect(svg.match(/<rect /g)).toHaveLength(3)
    expect(svg.match(/fill="currentColor" stroke="none"/g)).toHaveLength(3)
  })

  it('outline parts inherit the root stroke and carry no fill (image frame is outline)', () => {
    const svg = renderSvg(byId('xeno.image'))
    // The frame rect + the mountains path are outlines; the little sun rect is solid.
    expect(svg).toContain('fill="currentColor" stroke="none"') // the sun
    expect(svg).toMatch(/<rect x="3.5"[^>]*\/>/) // frame rect, no fill/stroke attrs of its own
    expect(svg).not.toMatch(/<rect x="3.5"[^>]*fill=/)
  })

  it('carries fill-rule through for holed compounds (search lens)', () => {
    expect(renderSvg(byId('xeno.search'))).toContain('fill-rule="evenodd"')
  })

  it('honours size and weight-derived stroke width, with an override', () => {
    const svg = renderSvg(byId('xeno.menu'), { size: 32 })
    expect(svg).toContain('width="32" height="32"')
    expect(svg).toContain('stroke-width="1.75"') // regular
    expect(renderSvg(byId('xeno.menu'), { strokeWidth: 2 })).toContain('stroke-width="2"')
  })
})

describe('renderSvg — axis proof (state changes markup, from pure data)', () => {
  it('a degenerate icon emits no data-<axis> attribute (data-glyph is always present)', () => {
    const svg = renderSvg(byId('xeno.menu'))
    expect(svg).toContain('data-glyph="menu"')
    expect(svg).not.toContain('data-selection')
    expect(svg).not.toContain('data-availability')
    expect(svg).not.toContain('data-interaction')
  })

  it('bookmark honours the selection axis: off = outline, on = filled', () => {
    const off = renderSvg(byId('xeno.bookmark')) // default selection:off
    const on = renderSvg(byId('xeno.bookmark'), { state: { selection: 'on' } })

    expect(off).toContain('data-selection="off"')
    expect(on).toContain('data-selection="on"')

    // off → the path is a stroked outline (no fill of its own)
    expect(off).not.toContain('fill="currentColor"')
    // on → the SAME silhouette is solid
    expect(on).toContain('fill="currentColor" stroke="none"')

    // Same viewBox/weight either way — only the geometry variant differs.
    expect(off).toContain('viewBox="0 0 24 24"')
    expect(on).toContain('viewBox="0 0 24 24"')
  })
})

describe('renderSvg — fails closed', () => {
  it('throws on a fill token the design system does not define', () => {
    expect(() => renderSvg(fakeRect({ fill: 'hotpink' }))).toThrow(/unknown fill token/)
  })

  it('accepts the foreground token', () => {
    expect(renderSvg(fakeRect({ fill: 'foreground' }))).toContain('fill="currentColor"')
  })

  it('throws on a non-finite coordinate rather than emitting NaN', () => {
    expect(() => renderSvg(fakeRect({ x: Number.NaN }))).toThrow(/non-finite/)
  })
})

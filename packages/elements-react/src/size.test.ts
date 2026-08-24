import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { controlSize, controlSizeTouch, touchTarget } from '@xenosystem/elements/tokens'

/**
 * Drift guard: the control metrics in `size.css` must equal the token DATA.
 *
 * They used to be emitted from the tokens at render time, which made drift impossible by
 * construction. Moving them into CSS bought a seam a surface can reach — and bought this risk with
 * it, so the guard replaces what the old design got for free. Same shape as `theme.test.ts`.
 */
/* Comments are stripped first. The file documents the surface seam with a worked example that is
 * itself a `[data-xeno-size='md']` rule, and a guard that reads prose as if it were a rule reports a
 * drift that does not exist — which is exactly what it did on the first run. */
const css = readFileSync(fileURLToPath(new URL('./size.css', import.meta.url)), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

/**
 * The declarations inside one size block. `prefix` picks the scale: the bare selector is the default
 * (pointer) scale, the surface-qualified one is touch.
 */
const block = (size: string, prefix = ''): Record<string, string> => {
  const sel = `${prefix}\\[data-xeno-size='${size}'\\]`
  const m = css.match(new RegExp(`${sel}\\s*\\{([^}]*)\\}`))
  if (!m?.[1]) throw new Error(`size.css has no '${prefix}' block for '${size}'`)
  const out: Record<string, string> = {}
  for (const decl of m[1].split(';')) {
    const [k, v] = decl.split(':')
    if (k?.trim() && v?.trim()) out[k.trim()] = v.trim()
  }
  return out
}

const expectMetrics = (
  vars: Record<string, string>,
  m: { height: number; padX: number; gap: number; font: number; icon: number },
) => {
  expect(vars['--xeno-h']).toBe(`${m.height}px`)
  expect(vars['--xeno-padx']).toBe(`${m.padX}px`)
  expect(vars['--xeno-gap']).toBe(`${m.gap}px`)
  expect(vars['--xeno-font']).toBe(`${m.font}px`)
  expect(vars['--xeno-icon']).toBe(`${m.icon}px`)
}

describe('size.css mirrors the control size tokens', () => {
  for (const [size, m] of Object.entries(controlSize)) {
    it(`${size} equals the pointer-scale token metrics`, () => {
      expectMetrics(block(size), m)
    })
  }

  for (const [size, m] of Object.entries(controlSizeTouch)) {
    it(`${size} equals the touch-scale token metrics`, () => {
      expectMetrics(block(size, "\\.xeno\\[data-surface='mobile'\\] "), m)
    })
  }

  it('covers every size the tokens declare, and no more', () => {
    const inCss = [...css.matchAll(/\[data-xeno-size='(\w+)'\]/g)].map((m) => m[1])
    expect([...new Set(inCss)].sort()).toEqual(Object.keys(controlSize).sort())
  })

  it('the hit target equals the token', () => {
    const m = css.match(/--xeno-hit:\s*([^;]+);/)
    expect(m?.[1]?.trim()).toBe(`${touchTarget}px`)
  })

  it('every touch size is at least as large as its pointer size', () => {
    // A "bigger for fingers" scale that is anywhere smaller is a typo, not a decision.
    for (const size of Object.keys(controlSize) as (keyof typeof controlSize)[]) {
      expect(controlSizeTouch[size].height).toBeGreaterThanOrEqual(controlSize[size].height)
      expect(controlSizeTouch[size].font).toBeGreaterThanOrEqual(controlSize[size].font)
      expect(controlSizeTouch[size].icon).toBeGreaterThanOrEqual(controlSize[size].icon)
    }
  })

  it('the glyph keeps its share of the control across both scales', () => {
    // The ratio is what reads, not the glyph's absolute size: a 16px mark in a 40px button is a
    // different design from the same mark in a 32px one. Allow a couple of points of rounding.
    for (const size of Object.keys(controlSize) as (keyof typeof controlSize)[]) {
      const pointer = controlSize[size].icon / controlSize[size].height
      const touch = controlSizeTouch[size].icon / controlSizeTouch[size].height
      expect(Math.abs(touch - pointer)).toBeLessThan(0.13)
    }
  })

  it('md and up clear the 16px iOS input-zoom threshold', () => {
    // Safari zooms the page when a focused input is under 16px, so a text field at md must not be.
    expect(controlSizeTouch.md.font).toBeGreaterThanOrEqual(16)
    expect(controlSizeTouch.lg.font).toBeGreaterThanOrEqual(16)
  })
})

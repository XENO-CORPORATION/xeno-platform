import { describe, it, expect } from 'vitest'
import { surface, accent, text, glass, radius, controlSize, status, easing, duration, stagger } from './index'

/**
 * Guards that the tokens are valid, MONOCHROME data — the one property the design system is strict about
 * (§2: white-at-opacity is the only accent; no chromatic brand colour). Fails closed: a token that is not
 * a neutral hex or a white/neutral rgba is rejected.
 */
const HEX = /^#[0-9a-f]{6}$/i
const RGBA_WHITE = /^rgba\(255, 255, 255, (0|1|0?\.\d+)\)$/
const RGBA = /^rgba\((\d+), (\d+), (\d+), (0|1|0?\.\d+)\)$/

/** True when an rgba string is near-neutral: its r/g/b channels span at most 16 (no chromatic tint). */
function neutralRgba(v: string): boolean {
  const m = v.match(RGBA)
  if (m === null) return false
  const r = Number(m[1]), g = Number(m[2]), b = Number(m[3])
  return Math.max(r, g, b) - Math.min(r, g, b) <= 16
}

describe('tokens — valid, monochrome (DESIGN_SYSTEM §2)', () => {
  it('every surface is an opaque hex', () => {
    for (const [k, v] of Object.entries(surface)) expect(v, k).toMatch(HEX)
  })

  it('every accent + glass value is white-at-opacity (the only accent)', () => {
    for (const [k, v] of Object.entries(accent)) expect(v, k).toMatch(RGBA_WHITE)
    expect(glass.bg).toMatch(RGBA_WHITE)
    expect(glass.border).toMatch(RGBA_WHITE)
  })

  it('every interactive-text value is a hex or a neutral rgba (never chromatic)', () => {
    for (const [k, v] of Object.entries(text)) {
      expect(HEX.test(v) || neutralRgba(v), `${k} = ${v}`).toBe(true)
    }
  })

  it('surfaces are dark (page is the darkest ground)', () => {
    expect(surface.page).toBe('#08080a')
  })

  it('radius scale is positive and strictly increasing (rounded squares, never circles)', () => {
    const scale = [radius.hair, radius.xs, radius.sm, radius.md, radius.control, radius.card]
    for (const r of scale) expect(r).toBeGreaterThan(0)
    for (let i = 1; i < scale.length; i++) expect(scale[i]!).toBeGreaterThan(scale[i - 1]!)
    // No value is large enough to read as a pill/circle at control size.
    for (const r of scale) expect(r).toBeLessThanOrEqual(12)
  })

  it('control sizes are the locked 24/28/32/36 ramp with finite metrics', () => {
    expect([controlSize.xs, controlSize.sm, controlSize.md, controlSize.lg].map((s) => s.height)).toEqual([
      24, 28, 32, 36,
    ])
    for (const [k, s] of Object.entries(controlSize)) {
      for (const n of [s.height, s.padX, s.gap, s.icon, s.font]) expect(Number.isFinite(n), k).toBe(true)
    }
  })

  it('status colours are hex; only status may carry hue (the monochrome-shell exception)', () => {
    for (const [k, v] of Object.entries(status)) expect(v, k).toMatch(HEX)
  })

  it('motion easings are cubic-bezier curves and durations a positive ladder', () => {
    for (const [k, v] of Object.entries(easing)) {
      expect(v, k).toMatch(/^cubic-bezier\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\)$/)
    }
    const ladder = [duration.fast, duration.base, duration.entrance, duration.modal]
    for (const d of ladder) expect(d).toBeGreaterThan(0)
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]!).toBeGreaterThan(ladder[i - 1]!)
    expect(stagger).toBeGreaterThan(0)
  })
})

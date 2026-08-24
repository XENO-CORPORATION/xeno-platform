import { describe, it, expect } from 'vitest'
import { checkCompatibility, type ElementContract, type ElementDeclaration } from './schema'

/**
 * Characterization + fail-closed tests for the SHIPPED `checkCompatibility` — the machine-checkable
 * promise behind automatic propagation ("may this change reach a shipped product without a rebuild?").
 *
 * These do not change the contract; they GUARD it. Each break case asserts the change is refused AND
 * names a reason, so the suite fails if the checker is ever made permissive (fails OPEN) — the exact
 * failure mode this ecosystem has shipped three times. The refinement cases assert the checker does not
 * blanket-reject, so the guard cannot pass by rejecting everything.
 */

const CONTRACT: ElementContract = {
  viewBox: '0 0 24 24',
  weight: 'regular',
  strokeFamily: 'xeno-regular',
  axes: ['selection'],
  signals: [],
}

function base(): ElementDeclaration {
  return {
    id: 'xeno.bookmark',
    kind: 'icon',
    contract: CONTRACT,
    geometry: { base: 'M6 4h12v17l-6-4-6 4z' },
    bindings: [],
    a11y: { role: 'img', label: 'Bookmark' },
  }
}

/** Clone `base()` with a partial contract override (nested, so we don't drop the other fields). */
function withContract(over: Partial<ElementContract>): ElementDeclaration {
  const b = base()
  return { ...b, contract: { ...b.contract, ...over } }
}

describe('checkCompatibility — refinements MUST pass (checker is not blanket-reject)', () => {
  it('accepts an identical declaration', () => {
    const r = checkCompatibility(base(), base())
    expect(r.compatible).toBe(true)
    expect(r.breaks).toEqual([])
  })

  it('accepts redrawn geometry (a product pins the contract, not the bytes)', () => {
    const next: ElementDeclaration = { ...base(), geometry: { base: 'M4 4h16v16H4z' } }
    expect(checkCompatibility(base(), next).compatible).toBe(true)
  })

  it('accepts an added geometry variant', () => {
    const next: ElementDeclaration = {
      ...base(),
      geometry: { base: 'M6 4h12v17l-6-4-6 4z', 'selection:on': 'M6 4h12v17l-6-4-6 4z' },
    }
    expect(checkCompatibility(base(), next).compatible).toBe(true)
  })

  it('accepts retuned bindings (timings are not part of the contract)', () => {
    const next: ElementDeclaration = {
      ...base(),
      bindings: [{ when: { selection: 'on' }, channel: 'opacity', to: 1, ms: 200 }],
    }
    expect(checkCompatibility(base(), next).compatible).toBe(true)
  })

  it('accepts an ADDED axis (widening what the element honours is not a break)', () => {
    const next = withContract({ axes: ['selection', 'availability'] })
    expect(checkCompatibility(base(), next).compatible).toBe(true)
  })

  it('accepts an ADDED signal', () => {
    const next = withContract({ signals: ['progress'] })
    expect(checkCompatibility(base(), next).compatible).toBe(true)
  })
})

describe('checkCompatibility — breaks MUST be refused (fails CLOSED)', () => {
  it('refuses a removed element', () => {
    const r = checkCompatibility(base(), undefined)
    expect(r.compatible).toBe(false)
    expect(r.breaks.join(' ')).toMatch(/removed/)
  })

  it('refuses an id change (ids are permanent)', () => {
    const r = checkCompatibility(base(), { ...base(), id: 'xeno.bookmark-2' })
    expect(r.compatible).toBe(false)
    expect(r.breaks.join(' ')).toMatch(/id changed/)
  })

  it('refuses a viewBox change (consumers size against it)', () => {
    const r = checkCompatibility(base(), withContract({ viewBox: '0 0 32 32' }))
    expect(r.compatible).toBe(false)
    expect(r.breaks.join(' ')).toMatch(/viewBox/)
  })

  it('refuses a weight change', () => {
    const r = checkCompatibility(base(), withContract({ weight: 'bold' }))
    expect(r.compatible).toBe(false)
    expect(r.breaks.join(' ')).toMatch(/weight/)
  })

  it('refuses a strokeFamily change', () => {
    const r = checkCompatibility(base(), withContract({ strokeFamily: 'xeno-bold' }))
    expect(r.compatible).toBe(false)
    expect(r.breaks.join(' ')).toMatch(/strokeFamily/)
  })

  it('refuses a DROPPED axis (consumers may be driving it)', () => {
    const r = checkCompatibility(base(), withContract({ axes: [] }))
    expect(r.compatible).toBe(false)
    expect(r.breaks.join(' ')).toMatch(/dropped axis "selection"/)
  })

  it('refuses a DROPPED signal', () => {
    const prev = withContract({ signals: ['progress', 'activity'] })
    const next = withContract({ signals: ['progress'] })
    const r = checkCompatibility(prev, next)
    expect(r.compatible).toBe(false)
    expect(r.breaks.join(' ')).toMatch(/dropped signal "activity"/)
  })

  it('reports EVERY break at once, not just the first', () => {
    const next = withContract({ viewBox: '0 0 20 20', axes: [] })
    const r = checkCompatibility(base(), next)
    expect(r.compatible).toBe(false)
    expect(r.breaks.length).toBeGreaterThanOrEqual(2)
  })
})

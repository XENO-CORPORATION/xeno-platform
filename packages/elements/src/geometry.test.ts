import { describe, it, expect } from 'vitest'
import { geometryMorphable } from './schema'

/**
 * `geometryMorphable` decides whether the `geometry` channel may INTERPOLATE two variants or must
 * CROSSFADE. It must fail CLOSED: anything it does not positively understand → not morphable.
 */
describe('geometryMorphable — fails closed', () => {
  it('same length + same kinds per slot → morphable', () => {
    expect(
      geometryMorphable(
        [{ kind: 'rect', x: 0, y: 0, w: 1, h: 1 }],
        [{ kind: 'rect', x: 1, y: 1, w: 2, h: 2, rx: 0.4 }],
      ),
    ).toBe(true)
  })

  it('different length → not morphable (renderer must crossfade)', () => {
    expect(
      geometryMorphable(
        [{ kind: 'rect', x: 0, y: 0, w: 1, h: 1 }],
        [
          { kind: 'rect', x: 0, y: 0, w: 1, h: 1 },
          { kind: 'rect', x: 0, y: 0, w: 1, h: 1 },
        ],
      ),
    ).toBe(false)
  })

  it('per-index kind mismatch → not morphable', () => {
    expect(
      geometryMorphable([{ kind: 'rect', x: 0, y: 0, w: 1, h: 1 }], [{ kind: 'path', d: 'M0 0h1' }]),
    ).toBe(false)
  })

  it('a legacy string normalises to exactly one path primitive', () => {
    expect(geometryMorphable('M0 0h1', [{ kind: 'path', d: 'M2 2h2' }])).toBe(true)
    expect(geometryMorphable('M0 0h1', [{ kind: 'rect', x: 0, y: 0, w: 1, h: 1 }])).toBe(false)
  })

  /* Matching KINDS lets an interpolator pair the shapes up; matching COMMANDS is what lets it pair the
     numbers up. Both of these are two-point paths and the old check called them morphable — a browser
     asked to interpolate them snaps to the end instead, which reads as a broken drawing rather than a
     failed check. */
  it('same kind, different commands → not morphable', () => {
    expect(
      geometryMorphable([{ kind: 'path', d: 'M4 12H19' }], [{ kind: 'path', d: 'M6.5 6.5L17.5 17.5' }]),
    ).toBe(false)
  })

  it('same commands in the same order → morphable, whatever the numbers are', () => {
    expect(
      geometryMorphable([{ kind: 'path', d: 'M4 12L19 12' }], [{ kind: 'path', d: 'M6.5 6.5L17.5 17.5' }]),
    ).toBe(true)
  })

  it('a zero-length segment is still a segment — it morphs like any other', () => {
    expect(
      geometryMorphable([{ kind: 'path', d: 'M13 18L19 12' }], [{ kind: 'path', d: 'M12 12L12 12' }]),
    ).toBe(true)
  })

  it('a Z at the end counts: closing one shape and not the other is a structural difference', () => {
    expect(geometryMorphable([{ kind: 'path', d: 'M0 0L1 1Z' }], [{ kind: 'path', d: 'M0 0L2 2' }])).toBe(false)
  })
})

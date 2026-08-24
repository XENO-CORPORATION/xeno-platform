import type { ElementDeclaration } from '../schema'

/**
 * `xeno.maximize` — Maximize. A degenerate element (pure geometry, no children).
 *
 * Four corner brackets, nothing between them. The conventional drawing is two arrows on a diagonal,
 * which says "bigger" but not "bigger WHAT" — corners describe the thing being resized, and the empty
 * middle is the area about to grow.
 *
 * Corners rather than arrows also gives the pair its motion for free: maximize pushes them apart,
 * minimize pulls them in, and the two animations are the same gesture with the sign flipped.
 *
 * part[0..3] = top-left, top-right, bottom-right, bottom-left, in reading order.
 */
export const Maximize: ElementDeclaration = {
  id: 'xeno.maximize',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M9.5 4.5H6A1.5 1.5 0 0 0 4.5 6v3.5' },
      { kind: 'path', d: 'M14.5 4.5H18A1.5 1.5 0 0 1 19.5 6v3.5' },
      { kind: 'path', d: 'M19.5 14.5V18A1.5 1.5 0 0 1 18 19.5h-3.5' },
      { kind: 'path', d: 'M4.5 14.5V18A1.5 1.5 0 0 0 6 19.5h3.5' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Maximize' },
  meta: { tags: ['expand', 'fullscreen', 'resize'], since: '0.2.0' },
}

export default Maximize

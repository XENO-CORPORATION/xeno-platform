import type { ElementDeclaration } from '../schema'

/**
 * `xeno.minimize` — Minimize. The twin of {@link Maximize}, and its exact inverse.
 *
 * Same four brackets, each turned to face OUTWARD: the elbows now point at the corners of the frame
 * rather than sitting in them, so the shape reads as something being drawn in from the edges. Kept as a
 * true mirror of maximize — if the two differ by anything except which way they face, the pair stops
 * being a pair.
 *
 * part[0..3] = top-left, top-right, bottom-right, bottom-left.
 */
export const Minimize: ElementDeclaration = {
  id: 'xeno.minimize',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M4.5 9.5H8A1.5 1.5 0 0 0 9.5 8V4.5' },
      { kind: 'path', d: 'M19.5 9.5H16A1.5 1.5 0 0 1 14.5 8V4.5' },
      { kind: 'path', d: 'M14.5 19.5V16A1.5 1.5 0 0 1 16 14.5h3.5' },
      { kind: 'path', d: 'M9.5 19.5V16A1.5 1.5 0 0 0 8 14.5H4.5' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Minimize' },
  meta: { tags: ['collapse', 'shrink', 'resize'], since: '0.2.0' },
}

export default Minimize

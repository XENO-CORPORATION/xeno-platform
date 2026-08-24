import type { ElementDeclaration } from '../schema'

/**
 * `xeno.check-square` - Done. A degenerate element (pure geometry, no children).
 *
 * `check` inside the shared `radius` frame - the same translation `stop` makes. The conventional drawing
 * puts the tick in a circle; this grammar has none, and the ring never carried meaning the frame does
 * not. What the frame does carry is a relationship: it is the same square as `contrast` and `stop`, so
 * the three read as one family of enclosed marks.
 *
 * part[0] = frame, part[1] = the tick.
 */
export const CheckSquare: ElementDeclaration = {
  id: 'xeno.check-square',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 3, y: 3, w: 18, h: 18, rx: 5 },
      { kind: 'path', d: 'M7.6 12.2 10.5 15.1 16.4 8.9' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Done' },
  meta: { tags: ['confirm', 'done', 'success'], since: '0.2.0' },
}

export default CheckSquare

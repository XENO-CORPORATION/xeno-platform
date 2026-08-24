import type { ElementDeclaration } from '../schema'

/**
 * `xeno.shapes` - Shapes. A degenerate element (pure geometry, no children).
 *
 * A triangle and a rounded square, overlapping. Which two shapes is not arbitrary: the square is this
 * grammar's whole vocabulary and the triangle is the one thing it never uses, so together they say
 * "shapes in general" rather than "these two shapes".
 *
 * The square is drawn SECOND, so at the overlap it sits over the triangle and one object clearly passes
 * in front of the other. Two outlines crossing with no order would read as a single compound cell.
 *
 * part[0] = triangle, part[1] = square.
 */
export const Shapes: ElementDeclaration = {
  id: 'xeno.shapes',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M9.4 3.6 15.6 13.4H3.2z' },
      { kind: 'rect', x: 11.6, y: 11.4, w: 9, h: 9, rx: 1.8 },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Shapes' },
  meta: { tags: ['shapes', 'artifact', 'objects'], since: '0.2.0' },
}

export default Shapes

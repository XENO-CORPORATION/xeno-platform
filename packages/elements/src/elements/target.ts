import type { ElementDeclaration } from '../schema'

/**
 * `xeno.target` — Accurate. A degenerate element (pure geometry, no children).
 *
 * Three rounded squares, nested and concentric. A target is the one thing in this set that is a circle
 * everywhere else it has ever been drawn, and it was left on the borrowed set for exactly that reason:
 * the argument was that a target IS round, so drawing it square is a lie about the object.
 *
 * What settled it was looking at the menu it lives in. Five rows, three of them XENO and two of them
 * rings at a lighter stroke — and the rings did not read as "the honest drawing of a target", they read
 * as two rows from a different product. A grammar is a claim about EVERY shape in it; the moment two
 * shapes opt out, it stops being a grammar and becomes a preference.
 *
 * And the square version turns out to lose nothing. What a target means here is not archery, it is
 * PRECISION — rings closing on a centre — and rings closing on a centre is what this is. The corner
 * radius shrinks with each ring, so the innermost mark is nearly a point: the shape gets more exact as
 * it gets smaller, which is the idea the glyph is for.
 *
 * part[0] = outer ring, part[1] = inner ring, part[2] = centre.
 */
export const Target: ElementDeclaration = {
  id: 'xeno.target',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 4.4, y: 4.4, w: 15.2, h: 15.2, rx: 3.2 },
      { kind: 'rect', x: 8.4, y: 8.4, w: 7.2, h: 7.2, rx: 1.6 },
      { kind: 'rect', x: 11, y: 11, w: 2, h: 2, rx: 0.6 },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Accurate' },
  meta: { tags: ['target', 'accurate', 'precision', 'aim', 'focus'], since: '0.2.0' },
}

export default Target

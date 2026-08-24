import type { ElementDeclaration } from '../schema'

/**
 * `xeno.sparkles` — New. A degenerate element (pure geometry, no children).
 *
 * Two four-pointed stars, one large and one small. Four points rather than five because a five-pointed
 * star is a RATING — it means quality, and this glyph means novelty; the two live a few pixels apart in
 * the same chat and must not be confused. Four points also has no orientation to get wrong: it reads the
 * same at every size and never looks tilted.
 *
 * The arms are concave — each is a quadratic whose control point sits just off the centre, so the star
 * pinches at its waist instead of being a diamond. That pinch is the entire difference between a sparkle
 * and a rhombus, and it costs one control point per arm.
 *
 * Two, not three or four. One star is a mark; two is a scatter, which is what a sparkle is. Beyond two
 * they stop being a scatter and start being a constellation, and the small one loses its job — which is
 * to be the second beat of the motion.
 *
 * part[0] = large star, part[1] = small star.
 */
export const Sparkles: ElementDeclaration = {
  id: 'xeno.sparkles',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M9.6 3.6Q10.5 8.7 15.6 9.6Q10.5 10.5 9.6 15.6Q8.7 10.5 3.6 9.6Q8.7 8.7 9.6 3.6Z' },
      { kind: 'path', d: 'M17.8 14.2Q18.3 16.9 21 17.4Q18.3 17.9 17.8 20.6Q17.3 17.9 14.6 17.4Q17.3 16.9 17.8 14.2Z' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'New' },
  meta: { tags: ['sparkles', 'new', 'magic', 'ai', 'enhance'], since: '0.2.0' },
}

export default Sparkles

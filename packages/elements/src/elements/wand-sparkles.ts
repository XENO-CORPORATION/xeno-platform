import type { ElementDeclaration } from '../schema'

/**
 * `xeno.wand-sparkles` — Rewrite. A degenerate element (pure geometry, no children).
 *
 * `sparkles`'s star, at the end of a stick. The family rule is the star: whatever it touches becomes the
 * thing being made new, so the same shape that means "new" on its own means "made new BY this" once
 * something is pointed at it.
 *
 * A wand is a hard thing to draw at this weight, because a single diagonal stroke is a slash and reads
 * as a prohibition. The band across it is what fixes that — a stick with a joint is an object, and the
 * joint is also where a hand would go. It sits at the lower third, so the wand has a handle and a
 * length rather than a middle.
 *
 * The star floats OFF the tip rather than sitting on it. Touching, it would be a lollipop; a gap is what
 * says the sparkle came out of the wand instead of being fixed to it — and it is what leaves the motion
 * somewhere to happen.
 *
 * part[0] = shaft, part[1] = joint, part[2] = star.
 */
export const WandSparkles: ElementDeclaration = {
  id: 'xeno.wand-sparkles',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M3.8 20.2L14 10' },
      { kind: 'path', d: 'M7 13.4L10.6 17' },
      { kind: 'path', d: 'M18.2 3.2Q18.7 5.9 21.4 6.4Q18.7 6.9 18.2 9.6Q17.7 6.9 15 6.4Q17.7 5.9 18.2 3.2Z' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Rewrite' },
  meta: { tags: ['wand', 'magic', 'rewrite', 'improve', 'ai'], since: '0.2.0' },
}

export default WandSparkles

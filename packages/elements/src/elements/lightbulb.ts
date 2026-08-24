import type { ElementDeclaration } from '../schema'

/**
 * `xeno.lightbulb` - Idea. A degenerate element (pure geometry, no children).
 *
 * A bulb with a threaded base. The bulb is a rounded-top rectangle, not a sphere on a stem: this grammar
 * has no circles, and a dome built from the same corner family as every other glyph is the translation
 * rather than an approximation of one.
 *
 * The glass is 8.8 units across. Narrower - the first draft was 7.2 - and the dome stops being wider
 * than its collar, at which point the glyph reads as a plug rather than as a bulb.
 *
 * part[0] = glass, part[1] = collar, part[2] = the contact at the bottom.
 */
export const Lightbulb: ElementDeclaration = {
  id: 'xeno.lightbulb',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M7.6 15V9.6A4.4 4.4 0 0 1 12 5.2 4.4 4.4 0 0 1 16.4 9.6V15z' },
      { kind: 'path', d: 'M9 17.8h6' },
      { kind: 'path', d: 'M10.2 20.6h3.6' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Idea' },
  meta: { tags: ['idea', 'hint', 'suggestion', 'tip'], since: '0.2.0' },
}

export default Lightbulb

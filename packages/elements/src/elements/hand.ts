import type { ElementDeclaration } from '../schema'

/**
 * `xeno.hand` - Hold. A degenerate element (pure geometry, no children).
 *
 * Four fingers as separate rounded bars over a palm, with the thumb crossing in from the left. Separate
 * bars rather than one scalloped outline: at 24px the notches between fingers in an outline close up to
 * less than the stroke weight and the hand turns into a mitten, and separate parts also let one finger
 * move without the rest.
 *
 * part[0..3] = fingers, part[4] = thumb, part[5] = palm.
 */
export const Hand: ElementDeclaration = {
  id: 'xeno.hand',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 7.4, y: 4.2, w: 2.6, h: 9, rx: 1.3 },
      { kind: 'rect', x: 10.4, y: 3.2, w: 2.6, h: 10, rx: 1.3 },
      { kind: 'rect', x: 13.4, y: 4.2, w: 2.6, h: 9, rx: 1.3 },
      { kind: 'rect', x: 16.4, y: 6.4, w: 2.6, h: 6.8, rx: 1.3 },
      { kind: 'path', d: 'M7.4 12.4 5.6 10.6a1.3 1.3 0 0 0-1.9 1.9l1.2 1.4' },
      { kind: 'path', d: 'M4.9 13.9l1.5 2.8A6 6 0 0 0 11.7 20.4h1.6a5.7 5.7 0 0 0 5.7-5.7v-1.5' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Hold' },
  meta: { tags: ['hand', 'hold', 'stop', 'manual'], since: '0.2.0' },
}

export default Hand

import type { ElementDeclaration } from '../schema'

/**
 * `xeno.pause` — Pause. A degenerate element (pure geometry, no children).
 *
 * Two upright bars. Same height and the same vertical centre as `play`'s triangle and `stop`'s square,
 * so the three swap in place without the row shifting — they are one control in three states, and a
 * control that jumps when its label changes reads as a different button.
 *
 * part[0] = left bar, part[1] = right bar, so they can move independently.
 */
export const Pause: ElementDeclaration = {
  id: 'xeno.pause',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 8, y: 5.6, w: 2.8, h: 12.8, rx: 0.9 },
      { kind: 'rect', x: 13.2, y: 5.6, w: 2.8, h: 12.8, rx: 0.9 },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Pause' },
  meta: { tags: ['media', 'hold', 'suspend'], since: '0.2.0' },
}

export default Pause

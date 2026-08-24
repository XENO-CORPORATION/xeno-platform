import type { ElementDeclaration } from '../schema'

/**
 * `xeno.user-x` — a person, withdrawn. A degenerate element (pure geometry, no children).
 *
 * The same head and shoulders as `xeno.user`, with a cross set against the shoulder line. It exists
 * because `user` alone cannot say it: the X IS the meaning — removed, excluded, not kept — and an icon
 * that drops it says the opposite of what was intended.
 *
 * The shoulders are shortened on the right to make room, so the cross sits beside the figure rather
 * than on top of it; two marks fighting for the same pixels read as neither.
 *
 * part[0] = head, part[1] = shoulders, part[2] and part[3] = the two strokes of the cross, kept apart
 * so each can draw itself in turn.
 */
export const UserX: ElementDeclaration = {
  id: 'xeno.user-x',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 5.5, y: 3.5, w: 8, h: 8, rx: 1.5 },
      { kind: 'path', d: 'M2 20.5V18.5A2.5 2.5 0 0 1 4.5 16H14.5A2.5 2.5 0 0 1 17 18.5V20.5' },
      { kind: 'path', d: 'M17.5 6.5l4.5 4.5' },
      { kind: 'path', d: 'M22 6.5l-4.5 4.5' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Remove user' },
  meta: { tags: ['temporary', 'remove', 'exclude'], since: '0.2.0' },
}

export default UserX

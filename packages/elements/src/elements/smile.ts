import type { ElementDeclaration } from '../schema'

/**
 * `xeno.smile` — Funny. A degenerate element (pure geometry, no children).
 *
 * A face, with no circle in it. The head is a rounded square at the family's LARGEST radius — 5.4 on a
 * 15.6 square, well past anything else in the set — which is the whole trick: soft enough to be a face,
 * still square enough to be from here. Drawn at `bot`'s radius it was a television with a mouth.
 *
 * That radius is also what separates it from `bot`, along with the two things `bot` has and this does
 * not: an antenna, and a head wider than it is tall. This one is square and bare, and the mouth carries
 * the rest.
 *
 * The eyes are strokes, as in `bot`, and here they earn it twice — they can narrow, and eyes narrowing
 * is most of what a real smile is. A face where only the mouth moves is a face being polite.
 *
 * part[0] = head, part[1..2] = eyes, part[3] = mouth.
 */
export const Smile: ElementDeclaration = {
  id: 'xeno.smile',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 4.2, y: 4.2, w: 15.6, h: 15.6, rx: 5.4 },
      { kind: 'path', d: 'M9.2 10L9.2 11.8' },
      { kind: 'path', d: 'M14.8 10L14.8 11.8' },
      { kind: 'path', d: 'M8.6 14.6C10 16.8 14 16.8 15.4 14.6' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Funny' },
  meta: { tags: ['smile', 'funny', 'face', 'happy', 'reaction'], since: '0.2.0' },
}

export default Smile

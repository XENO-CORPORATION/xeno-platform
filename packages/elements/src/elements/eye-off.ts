import type { ElementDeclaration } from '../schema'

/**
 * `xeno.eye-off` — Hidden. A degenerate element (pure geometry, no children).
 *
 * `eye` with a stroke through it. The lens and the pupil are the SAME coordinates as `eye`, not a
 * redrawn approximation of it: an "off" glyph is the on one plus a denial, and if the object underneath
 * shifted by even half a unit the pair would flicker when a control toggles between them.
 *
 * The slash runs corner to corner and is shared with `mic-off` and `timer-off` — one mark, one meaning,
 * across every glyph that negates something.
 *
 * part[0] = lens, part[1] = pupil, part[2] = the slash.
 */
export const EyeOff: ElementDeclaration = {
  id: 'xeno.eye-off',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M2.5 12 6 8.5H18L21.5 12 18 15.5H6Z' },
      { kind: 'rect', x: 9.6, y: 9.6, w: 4.8, h: 4.8, rx: 1, fill: 'foreground' },
      { kind: 'path', d: 'M4.2 4.2 19.8 19.8' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Hidden' },
  meta: { tags: ['hide', 'invisible', 'private'], since: '0.2.0' },
}

export default EyeOff

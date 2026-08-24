import type { ElementDeclaration } from '../schema'

/**
 * `xeno.building` — Team. A degenerate element (pure geometry, no children).
 *
 * A block with a door and six lit windows. It stands for an organisation rather than a person, which is
 * why it is a building and not a group of figures: `user` already means one person and a cluster of
 * three small figures at 24px is a smear.
 *
 * The windows are separate parts on purpose. They are what the glyph does — they light up in sequence —
 * and a single part cannot stagger against itself.
 *
 * part[0] = walls, part[1] = ground line, part[2] = door, part[3..8] = the windows, in reading order.
 */
export const Building: ElementDeclaration = {
  id: 'xeno.building',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M4.5 20.5V4.6A1.1 1.1 0 0 1 5.6 3.5h12.8a1.1 1.1 0 0 1 1.1 1.1v15.9' },
      { kind: 'path', d: 'M3.4 20.5h17.2' },
      { kind: 'path', d: 'M10 20.5v-3.9h4v3.9' },
      { kind: 'rect', x: 7.4, y: 6.6, w: 2.2, h: 2.2, rx: 0.4, fill: 'foreground' },
      { kind: 'rect', x: 10.9, y: 6.6, w: 2.2, h: 2.2, rx: 0.4, fill: 'foreground' },
      { kind: 'rect', x: 14.4, y: 6.6, w: 2.2, h: 2.2, rx: 0.4, fill: 'foreground' },
      { kind: 'rect', x: 7.4, y: 11, w: 2.2, h: 2.2, rx: 0.4, fill: 'foreground' },
      { kind: 'rect', x: 10.9, y: 11, w: 2.2, h: 2.2, rx: 0.4, fill: 'foreground' },
      { kind: 'rect', x: 14.4, y: 11, w: 2.2, h: 2.2, rx: 0.4, fill: 'foreground' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Team' },
  meta: { tags: ['team', 'organisation', 'company', 'workspace'], since: '0.2.0' },
}

export default Building

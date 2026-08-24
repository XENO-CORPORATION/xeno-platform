import type { ElementDeclaration } from '../schema'

/**
 * `xeno.save` - Save. A degenerate element (pure geometry, no children).
 *
 * A disk: the shell with its cut corner, the shutter at the top and the label below. The cut corner is
 * not decoration - it is the only part of the silhouette separating this from `file` and from a plain
 * rounded square. Without it the glyph is a box with two boxes in it.
 *
 * part[0] = shell, part[1] = shutter, part[2] = label.
 */
export const Save: ElementDeclaration = {
  id: 'xeno.save',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M4.4 5.8A1.4 1.4 0 0 1 5.8 4.4h9.6L19.6 8.6v9.6a1.4 1.4 0 0 1-1.4 1.4H5.8a1.4 1.4 0 0 1-1.4-1.4z' },
      { kind: 'path', d: 'M8 4.4v4.4h6.4V4.4' },
      { kind: 'rect', x: 7.6, y: 12.4, w: 8.8, h: 7.2, rx: 1 },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Save' },
  meta: { tags: ['save', 'disk', 'store'], since: '0.2.0' },
}

export default Save

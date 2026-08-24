import type { ElementDeclaration } from '../schema'

/**
 * `xeno.panel-right` — {@link PanelLeft} mirrored: the rail is on the right.
 *
 * Mirrored in the COORDINATES, not with a transform. A transform would have to be carried by every
 * renderer that consumes the declaration, and the grammar keeps geometry resolved.
 *
 * part[0] = frame, part[1] = rail, part[2] = chevron.
 */
export const PanelRight: ElementDeclaration = {
  id: 'xeno.panel-right',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 3, y: 4, w: 18, h: 16, rx: 2.4 },
      { kind: 'path', d: 'M15 4v16' },
      { kind: 'path', d: 'M10.6 9.6 8.2 12l2.4 2.4' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Open right panel' },
  meta: { tags: ['panel', 'sidebar', 'layout', 'open'], since: '0.2.0' },
}

export default PanelRight

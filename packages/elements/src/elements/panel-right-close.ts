import type { ElementDeclaration } from '../schema'

/**
 * `xeno.panel-right-close` — the twin of {@link PanelRight}: same frame, same rail, chevron reversed.
 *
 * part[0] = frame, part[1] = rail, part[2] = chevron.
 */
export const PanelRightClose: ElementDeclaration = {
  id: 'xeno.panel-right-close',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 3, y: 4, w: 18, h: 16, rx: 2.4 },
      { kind: 'path', d: 'M15 4v16' },
      { kind: 'path', d: 'M8.2 9.6 10.6 12l-2.4 2.4' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Close right panel' },
  meta: { tags: ['panel', 'sidebar', 'layout', 'close'], since: '0.2.0' },
}

export default PanelRightClose

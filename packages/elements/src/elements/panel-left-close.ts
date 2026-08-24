import type { ElementDeclaration } from '../schema'

/**
 * `xeno.panel-left-close` — the twin of {@link PanelLeft}: same frame, same rail, chevron reversed.
 *
 * See `panel-left.ts` for why the four are authored as one set.
 *
 * part[0] = frame, part[1] = rail, part[2] = chevron.
 */
export const PanelLeftClose: ElementDeclaration = {
  id: 'xeno.panel-left-close',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 3, y: 4, w: 18, h: 16, rx: 2.4 },
      { kind: 'path', d: 'M9 4v16' },
      // Pointing back AT the rail: this one folds the panel away.
      { kind: 'path', d: 'M15.8 9.6 13.4 12l2.4 2.4' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Close left panel' },
  meta: { tags: ['panel', 'sidebar', 'layout', 'close'], since: '0.2.0' },
}

export default PanelLeftClose

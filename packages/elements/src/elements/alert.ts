import type { ElementDeclaration } from '../schema'

/**
 * `xeno.alert` — Alert. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Alert: ElementDeclaration = {
  id: 'xeno.alert',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 3.5, y: 3.5, w: 17, h: 17, rx: 2 },
      { kind: 'rect', x: 11.1, y: 7, w: 1.8, h: 6, rx: 0.4, fill: 'foreground' },
      { kind: 'rect', x: 11.2, y: 15.3, w: 1.6, h: 1.6, rx: 0.3, fill: 'foreground' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Alert' },
  meta: { tags: ['warning', 'caution', 'exclamation'], since: '0.1.0' },
}

export default Alert

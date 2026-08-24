import type { ElementDeclaration } from '../schema'

/**
 * `xeno.lock` — Lock. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Lock: ElementDeclaration = {
  id: 'xeno.lock',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 3.5, y: 10.5, w: 17, h: 9.5, rx: 1 },
      { kind: 'path', d: 'M8 10.5V6H16V10.5' },
      { kind: 'rect', x: 10.9, y: 13, w: 2.2, h: 2.2, rx: 0.3, fill: 'foreground' },
      { kind: 'rect', x: 11.4, y: 14.7, w: 1.2, h: 2.3, rx: 0.2, fill: 'foreground' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Lock' },
  meta: { tags: ['secure', 'padlock', 'private'], since: '0.1.0' },
}

export default Lock

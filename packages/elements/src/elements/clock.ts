import type { ElementDeclaration } from '../schema'

/**
 * `xeno.clock` — Clock. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Clock: ElementDeclaration = {
  id: 'xeno.clock',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 3.5, y: 3.5, w: 17, h: 17, rx: 2 },
      { kind: 'path', d: 'M12 7.5V12l3.2 2' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Clock' },
  meta: { tags: ['time', 'schedule'], since: '0.1.0' },
}

export default Clock

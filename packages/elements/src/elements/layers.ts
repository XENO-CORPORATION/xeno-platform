import type { ElementDeclaration } from '../schema'

/**
 * `xeno.layers` — Layers. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Layers: ElementDeclaration = {
  id: 'xeno.layers',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M12 3l9 5-9 5-9-5 9-5z' },
      { kind: 'path', d: 'M3.2 12L12 17l8.8-5' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Layers' },
  meta: { tags: ['stack', 'z'], since: '0.1.0' },
}

export default Layers

import type { ElementDeclaration } from '../schema'

/**
 * `xeno.download` — Download. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Download: ElementDeclaration = {
  id: 'xeno.download',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    // Split the arrow (shaft + head) from the tray so the arrow can plunge INTO a still tray —
    // part[0] = arrow, part[1] = tray/landing line.
    base: [
      { kind: 'path', d: 'M12 4v11M8 11l4 4 4-4' },
      { kind: 'path', d: 'M5 20h14' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Download' },
  meta: { tags: ['save', 'import'], since: '0.1.0' },
}

export default Download

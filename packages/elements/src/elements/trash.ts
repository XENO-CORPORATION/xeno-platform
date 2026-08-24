import type { ElementDeclaration } from '../schema'

/**
 * `xeno.trash` — Trash. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Trash: ElementDeclaration = {
  id: 'xeno.trash',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    // Split into lid (rim + handle) and bin so the lid can open independently — part[0] = lid, part[1] = bin.
    base: [
      { kind: 'path', d: 'M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2' },
      { kind: 'path', d: 'M6.5 7l.9 12a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9l.9-12' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Trash' },
  meta: { tags: ['delete', 'bin', 'remove'], since: '0.1.0' },
}

export default Trash

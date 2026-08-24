import type { ElementDeclaration } from '../schema'

/**
 * `xeno.edit` — Edit. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Edit: ElementDeclaration = {
  id: 'xeno.edit',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M13.5 6.5 17.5 10.5 7.5 20.5 3.5 21.5 4.5 17.5Z' },
      { kind: 'path', d: 'M11.5 8.5 15.5 12.5' },
      // part[2] = the stroke the pencil writes; hidden at rest, drawn under the tip as the pencil travels.
      { kind: 'path', d: 'M4.6 21.9H12.1' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Edit' },
  meta: { tags: ['pencil', 'write', 'compose'], since: '0.1.0' },
}

export default Edit

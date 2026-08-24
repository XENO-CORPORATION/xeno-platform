import type { ElementDeclaration } from '../schema'

/**
 * `xeno.folder` — Folder. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Folder: ElementDeclaration = {
  id: 'xeno.folder',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      // parts[0..2] = a document (sheet + two lines of text). Declared FIRST so the folder body is
      // painted over it, and hidden at rest — on hover it rises up out of the folder's mouth.
      // Its bottom edge sits EXACTLY on the folder's top edge (y 7.4, over the flat run x 10.4→16.4), so the
      // sheet's own edge and the folder's coincide — nothing is ever drawn below the line, inside the folder.
      { kind: 'rect', x: 10.4, y: 1.6, w: 6, h: 5.8, rx: 0.6 },
      { kind: 'path', d: 'M11.8 3.6h3.2' },
      { kind: 'path', d: 'M11.8 5.4h3.2' },
      // part[3] = the folder body.
      { kind: 'path', d: 'M3 6.4A1.4 1.4 0 0 1 4.4 5h4l2 2.4h6A1.4 1.4 0 0 1 17.8 8.8V17a1.4 1.4 0 0 1-1.4 1.4H4.4A1.4 1.4 0 0 1 3 17z' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Folder' },
  meta: { tags: ['directory'], since: '0.1.0' },
}

export default Folder

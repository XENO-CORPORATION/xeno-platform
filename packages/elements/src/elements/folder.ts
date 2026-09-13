import type { ElementDeclaration } from '../schema'

/**
 * `xeno.folder` — Folder. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 *
 * ⚠️ The body is CENTRED IN THE VIEWBOX, and was not until 2026-09-13: it ran x 3→17.8, centre
 * 10.4 against the viewBox centre 12. The whole glyph — document, both text rules and the body —
 * moved +1.6 in x together, so the sheet still emerges over the body's flat run and its bottom
 * edge still coincides with the folder's top edge. `folder-up` shares this body and had the same
 * defect; if you edit one, measure the other.
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
      { kind: 'rect', x: 12, y: 1.6, w: 6, h: 5.8, rx: 0.6 },
      { kind: 'path', d: 'M13.4 3.6h3.2' },
      { kind: 'path', d: 'M13.4 5.4h3.2' },
      // part[3] = the folder body.
      { kind: 'path', d: 'M4.6 6.4A1.4 1.4 0 0 1 6 5h4l2 2.4h6A1.4 1.4 0 0 1 19.4 8.8V17a1.4 1.4 0 0 1-1.4 1.4H6A1.4 1.4 0 0 1 4.6 17z' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Folder' },
  meta: { tags: ['directory'], since: '0.1.0' },
}

export default Folder

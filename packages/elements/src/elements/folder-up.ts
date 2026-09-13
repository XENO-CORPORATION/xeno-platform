import type { ElementDeclaration } from '../schema'

/**
 * `xeno.folder-up` — Upload to folder. A degenerate element (pure geometry, no children).
 *
 * `folder`'s body with an arrow rising inside it. It carries only the body, not the document `folder`
 * keeps hidden above its mouth: that document is `folder`'s own motion, and a glyph that borrowed the
 * shape without the motion would be a folder with a stray sheet stuck to its lid.
 *
 * part[0] = folder body, part[1] = shaft, part[2] = head.
 *
 * ⚠️ The body is CENTRED IN THE VIEWBOX, and was not until 2026-09-13. It ran x 3→17.8, whose
 * centre is 10.4 — 1.6 units left of the viewBox centre 12, i.e. ~10% of the box. Every glyph
 * beside it in the chat composer (`plus`, `mic`, `arrow-up`) measures dx = 0, so this one alone
 * read as badly centred inside an otherwise correct button, and the instinct was to nudge the
 * BUTTON. Measured across all 101 declarations, 82% sit within ±0.5 of centre; this was an
 * outlier. The whole glyph is shifted +1.6 in x — proportions and the arrow's position inside
 * the body are untouched. `folder` carried the identical body and the identical defect.
 */
export const FolderUp: ElementDeclaration = {
  id: 'xeno.folder-up',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M4.6 6.4A1.4 1.4 0 0 1 6 5h4l2 2.4h6A1.4 1.4 0 0 1 19.4 8.8V17a1.4 1.4 0 0 1-1.4 1.4H6A1.4 1.4 0 0 1 4.6 17z' },
      { kind: 'path', d: 'M12 16v-5' },
      { kind: 'path', d: 'M9.6 13.4 12 11l2.4 2.4' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Upload to folder' },
  meta: { tags: ['folder', 'upload', 'move'], since: '0.2.0' },
}

export default FolderUp

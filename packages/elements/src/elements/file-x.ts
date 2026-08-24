import type { ElementDeclaration } from '../schema'

/**
 * `xeno.file-x` — a file marked for removal. A degenerate element (pure geometry, no children).
 *
 * `file`'s sheet and corner fold, unchanged, with the mark standing where the LINES OF TEXT are in
 * `file`. That placement is the rule for this whole family (`file-x`, `file-out`, `message-plus`,
 * `message-x`): the mark replaces the object's contents rather than sitting on top of
 * them. A mark laid over the text lines has to be small enough to fit between them, and at 24px small
 * means thin — below the weight the rest of the set carries. Taking the contents' place gives the mark
 * room to be drawn at full weight, and says something true besides: what the file holds is no longer
 * the point.
 *
 * part[0] = sheet, part[1] = fold, part[2..3] = the two strokes of the cross.
 */
export const FileX: ElementDeclaration = {
  id: 'xeno.file-x',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M13 3H7a1.4 1.4 0 0 0-1.4 1.4v15.2A1.4 1.4 0 0 0 7 21h10a1.4 1.4 0 0 0 1.4-1.4V9z' },
      { kind: 'path', d: 'M13 3v6h6' },
      { kind: 'path', d: 'M9.4 13.6 14.6 18.8' },
      { kind: 'path', d: 'M14.6 13.6 9.4 18.8' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Remove file' },
  meta: { tags: ['file', 'delete', 'reject'], since: '0.2.0' },
}

export default FileX

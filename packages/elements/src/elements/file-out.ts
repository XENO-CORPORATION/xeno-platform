import type { ElementDeclaration } from '../schema'

/**
 * `xeno.file-out` — Export. A degenerate element (pure geometry, no children).
 *
 * `file` with an arrow where its text lines are. See `file-x.ts` for why the mark takes the contents'
 * place. The arrow points right, the direction everything in this grammar leaves by (`send`,
 * `arrow-right`, the panel chevrons) — a direction that means one thing everywhere is worth more than a
 * drawing that is locally prettier.
 *
 * part[0] = sheet, part[1] = fold, part[2] = shaft, part[3] = head.
 */
export const FileOut: ElementDeclaration = {
  id: 'xeno.file-out',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M13 3H7a1.4 1.4 0 0 0-1.4 1.4v15.2A1.4 1.4 0 0 0 7 21h10a1.4 1.4 0 0 0 1.4-1.4V9z' },
      { kind: 'path', d: 'M13 3v6h6' },
      { kind: 'path', d: 'M8.4 16.2h6.6' },
      { kind: 'path', d: 'M12.6 13.8 15 16.2l-2.4 2.4' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Export file' },
  meta: { tags: ['file', 'export', 'output'], since: '0.2.0' },
}

export default FileOut

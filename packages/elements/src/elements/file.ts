import type { ElementDeclaration } from '../schema'

/**
 * `xeno.file` — File. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const File: ElementDeclaration = {
  id: 'xeno.file',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M13 3H7a1.4 1.4 0 0 0-1.4 1.4v15.2A1.4 1.4 0 0 0 7 21h10a1.4 1.4 0 0 0 1.4-1.4V9z' },
      { kind: 'path', d: 'M13 3v6h6' },
      // parts[2..4] = lines of text; they write themselves in on hover (a document being filled).
      { kind: 'path', d: 'M8 12h8' },
      { kind: 'path', d: 'M8 14.6h8' },
      { kind: 'path', d: 'M8 17.2h5' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'File' },
  meta: { tags: ['document', 'page'], since: '0.1.0' },
}

export default File

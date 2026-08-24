import type { ElementDeclaration } from '../schema'

/**
 * `xeno.upload` — Upload. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Upload: ElementDeclaration = {
  id: 'xeno.upload',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M12 15V4M8 8l4-4 4 4' },
      { kind: 'path', d: 'M5 15v3.5A1 1 0 0 0 6 19.5H18A1 1 0 0 0 19 18.5V15' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Upload' },
  meta: { tags: ['export', 'send'], since: '0.1.0' },
}

export default Upload

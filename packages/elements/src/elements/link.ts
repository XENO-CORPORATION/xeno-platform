import type { ElementDeclaration } from '../schema'

/**
 * `xeno.link` — Link. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Link: ElementDeclaration = {
  id: 'xeno.link',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M9.5 8H7A2.5 2.5 0 0 0 4.5 10.5V13.5A2.5 2.5 0 0 0 7 16H9.5' },
      { kind: 'path', d: 'M14.5 8H17A2.5 2.5 0 0 1 19.5 10.5V13.5A2.5 2.5 0 0 1 17 16H14.5' },
      { kind: 'path', d: 'M8.5 12H15.5' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Link' },
  meta: { tags: ['chain', 'url', 'hyperlink'], since: '0.1.0' },
}

export default Link

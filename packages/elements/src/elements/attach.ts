import type { ElementDeclaration } from '../schema'

/**
 * `xeno.attach` — Attach. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Attach: ElementDeclaration = {
  id: 'xeno.attach',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M11.5 15V7A0.9 0.9 0 0 1 12.4 6.1H15.1A0.9 0.9 0 0 1 16 7V17A1.2 1.2 0 0 1 14.8 18.2H8.7A1.2 1.2 0 0 1 7.5 17V8' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Attach' },
  meta: { tags: ['paperclip', 'file'], since: '0.1.0' },
}

export default Attach

import type { ElementDeclaration } from '../schema'

/**
 * `xeno.message` — Message. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Message: ElementDeclaration = {
  id: 'xeno.message',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9.5L5 20V6a1 1 0 0 1 1-1z' },
      { kind: 'path', d: 'M8.5 10h7M8.5 13h4' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Message' },
  meta: { tags: ['chat', 'bubble', 'comment'], since: '0.1.0' },
}

export default Message

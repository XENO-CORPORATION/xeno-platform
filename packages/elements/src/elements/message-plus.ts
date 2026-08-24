import type { ElementDeclaration } from '../schema'

/**
 * `xeno.message-plus` — New message. A degenerate element (pure geometry, no children).
 *
 * `message`'s bubble, unchanged, with a plus where its two lines of text are — the family rule from
 * `file-x.ts`. A new message has no contents yet, so replacing them is not a compromise here; it is the
 * literal state.
 *
 * part[0] = bubble, part[1] = horizontal stroke, part[2] = vertical stroke.
 */
export const MessagePlus: ElementDeclaration = {
  id: 'xeno.message-plus',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9.5L5 20V6a1 1 0 0 1 1-1z' },
      { kind: 'path', d: 'M9.2 10.5h6.4' },
      { kind: 'path', d: 'M12.4 7.3v6.4' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'New message' },
  meta: { tags: ['chat', 'new', 'compose'], since: '0.2.0' },
}

export default MessagePlus

import type { ElementDeclaration } from '../schema'

/**
 * `xeno.message-x` — Dismiss conversation. A degenerate element (pure geometry, no children).
 *
 * The twin of {@link MessagePlus}: same bubble, same place, the other mark. Kept a true pair — one adds
 * a conversation and one takes it away, and they sit next to each other often enough that any difference
 * beyond the mark itself would read as two different bubbles.
 *
 * part[0] = bubble, part[1..2] = the two strokes of the cross.
 */
export const MessageX: ElementDeclaration = {
  id: 'xeno.message-x',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9.5L5 20V6a1 1 0 0 1 1-1z' },
      { kind: 'path', d: 'M10.1 8.2 14.7 12.8' },
      { kind: 'path', d: 'M14.7 8.2 10.1 12.8' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Dismiss conversation' },
  meta: { tags: ['chat', 'close', 'dismiss'], since: '0.2.0' },
}

export default MessageX

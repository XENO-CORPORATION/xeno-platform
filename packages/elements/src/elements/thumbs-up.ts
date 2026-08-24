import type { ElementDeclaration } from '../schema'

/**
 * `xeno.thumbs-up` - Good response. A degenerate element (pure geometry, no children).
 *
 * A cuff and a hand: the small rounded square is the wrist, the larger shape is the palm with the thumb
 * rising off its top edge. Two parts rather than one outline, so the thumb can move without the wrist
 * following - a hand whose base travelled with its thumb would read as the whole arm lifting.
 *
 * Sized against the set, not against the box. The first draft filled 17.5 x 15.8 of the 24 grid, which is
 * WIDER than `copy` (15) or `edit` (14) and only a shade under `info`, a full square frame — and a dense
 * silhouette carries far more optical weight than an outline of the same span. Beside its neighbours in
 * the message action bar it read as one size larger. Scaled to 0.857 about its own ink centre, it matches
 * `copy`'s width and sits a little shorter, which is what a solid shape has to do to weigh the same.
 *
 * Kept a strict mirror of {@link ThumbsDown}. The two sit side by side under every answer, and any
 * difference beyond the flip would show up as one being drawn better than the other.
 *
 * part[0] = cuff, part[1] = palm and thumb.
 */
export const ThumbsUp: ElementDeclaration = {
  id: 'xeno.thumbs-up',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 4.5, y: 10.9, w: 3.6, h: 7.9, rx: 1 },
      { kind: 'path', d: 'M8.1 11.2 11.4 5.9a1.5 1.5 0 0 1 2.8 0.9L13.6 10.2h4.2a1.7 1.7 0 0 1 1.7 2.1l-1.1 5a1.7 1.7 0 0 1-1.7 1.4H8.1z' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Good response' },
  meta: { tags: ['like', 'approve', 'positive'], since: '0.2.0' },
}

export default ThumbsUp

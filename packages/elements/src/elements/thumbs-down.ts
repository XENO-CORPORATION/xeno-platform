import type { ElementDeclaration } from '../schema'

/**
 * `xeno.thumbs-down` - Bad response. The mirror of {@link ThumbsUp}, and nothing else.
 *
 * Every coordinate is its twin reflected through the horizontal centre line of the 24 box, resolved into
 * these numbers rather than carried as a transform - the grammar keeps geometry resolved so no renderer
 * has to apply one.
 *
 * part[0] = cuff, part[1] = palm and thumb.
 */
export const ThumbsDown: ElementDeclaration = {
  id: 'xeno.thumbs-down',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 4.5, y: 5.2, w: 3.6, h: 7.9, rx: 1 },
      { kind: 'path', d: 'M8.1 12.8 11.4 18.1a1.5 1.5 0 0 0 2.8-0.9L13.6 13.8h4.2a1.7 1.7 0 0 0 1.7-2.1l-1.1-5a1.7 1.7 0 0 0-1.7-1.4H8.1z' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Bad response' },
  meta: { tags: ['dislike', 'reject', 'negative'], since: '0.2.0' },
}

export default ThumbsDown

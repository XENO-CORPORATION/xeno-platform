import type { ElementDeclaration } from '../schema'

/**
 * `xeno.bot` — Agent. A degenerate element (pure geometry, no children).
 *
 * The object + sign group, at its most literal: a rounded square is the whole vocabulary of this set,
 * and a rounded square with two eyes in it is a face. Nothing else has to be added — no ears, no mouth,
 * no body. Every one of those is a detail a 24-unit sheet cannot hold at this stroke weight, and each
 * would cost the thing that actually carries the meaning.
 *
 * The eyes are STROKES, not dots, for the same reason the grammar has no circles — and it buys the
 * motion too: a two-unit vertical segment can close to nothing and open again, which is a blink. A dot
 * can only shrink, and a shrinking dot is not a blink, it is a fade.
 *
 * The antenna is what separates this from `monitor`. A screen with a stalk on top and a node at the end
 * of it is not a screen any more; it is something that receives.
 *
 * part[0] = antenna node, part[1] = stem, part[2] = head, part[3..4] = eyes.
 */
export const Bot: ElementDeclaration = {
  id: 'xeno.bot',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 10.6, y: 2.6, w: 2.8, h: 2.8, rx: 0.9 },
      { kind: 'path', d: 'M12 5.4L12 8' },
      { kind: 'rect', x: 4.2, y: 8, w: 15.6, h: 11.4, rx: 2.6 },
      { kind: 'path', d: 'M8.8 12.6L8.8 14.6' },
      { kind: 'path', d: 'M15.2 12.6L15.2 14.6' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Agent' },
  meta: { tags: ['bot', 'agent', 'assistant', 'robot', 'ai'], since: '0.2.0' },
}

export default Bot

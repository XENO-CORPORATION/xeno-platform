import type { ElementDeclaration } from '../schema'

/**
 * `xeno.archive` — Archive. A degenerate element (pure geometry, no children).
 *
 * A lidded box with a slot. Deliberately NOT the same silhouette as `trash`, because the two are the
 * pair a user is most likely to confuse and the consequence of confusing them is losing something:
 * trash tapers toward the bottom, archive is a straight-sided crate, and only archive has the slot —
 * the mark that says things come back OUT of it.
 *
 * Split into lid / body / slot so the lid can move on its own — part[0] = lid, part[1] = body,
 * part[2] = slot.
 *
 * It honours `selection`, and the ON state fills the LID only. Filling the whole silhouette — which is
 * what `bookmark` does — turns a three-part glyph into a block; filling the body instead would swallow
 * the slot, since a `foreground` fill and a `currentColor` stroke are the same ink and the one mark
 * that distinguishes this from `trash` would vanish exactly when the state is on. A sealed lid over an
 * open crate says put away without saying gone.
 *
 * Same three primitives in the same order with the same commands, so the two variants MORPH.
 */
export const Archive: ElementDeclaration = {
  id: 'xeno.archive',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: ['selection'], signals: [] },
  geometry: {
    base: [
      { kind: 'rect', x: 3, y: 4, w: 18, h: 4.4, rx: 1.2 },
      { kind: 'path', d: 'M5 8.4v9.6A2 2 0 0 0 7 20h10a2 2 0 0 0 2-2V8.4' },
      { kind: 'path', d: 'M9.9 12.4h4.2' },
    ],
    'selection:on': [
      { kind: 'rect', x: 3, y: 4, w: 18, h: 4.4, rx: 1.2, fill: 'foreground' },
      { kind: 'path', d: 'M5 8.4v9.6A2 2 0 0 0 7 20h10a2 2 0 0 0 2-2V8.4' },
      { kind: 'path', d: 'M9.9 12.4h4.2' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Archive' },
  meta: { tags: ['store', 'box', 'keep'], since: '0.2.0' },
}

export default Archive

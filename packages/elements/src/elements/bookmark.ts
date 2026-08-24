import type { ElementDeclaration } from '../schema'

/**
 * `xeno.bookmark` — Bookmark.
 *
 * The canonical STATEFUL element (SPEC §5, schema `Selection`): a bookmark is off or on, and that
 * selection outlives the tap that set it. It honours the `selection` axis — `off` is the outline
 * `base`, `on` is the same silhouette FILLED (`selection:on`). Same path, same length/kind, so the
 * two variants morph rather than crossfade (`geometryMorphable` → true).
 *
 * Hand-authored beyond the foundry import (which only knows the static outline). Declarations are the
 * source of truth; do not regenerate this one from the workbench.
 */
export const Bookmark: ElementDeclaration = {
  id: 'xeno.bookmark',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: ['selection'], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M6 4h12v17l-6-4-6 4z' },
    ],
    'selection:on': [
      { kind: 'path', d: 'M6 4h12v17l-6-4-6 4z', fill: 'foreground' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Bookmark' },
  meta: { tags: ['save', 'flag', 'ribbon'], since: '0.1.0' },
}

export default Bookmark

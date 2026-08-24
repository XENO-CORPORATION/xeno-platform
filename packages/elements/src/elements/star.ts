import type { ElementDeclaration } from '../schema'

/**
 * `xeno.star` — Star.
 *
 * Stateful for the same reason `bookmark` is: starring a thing is a choice that outlives the tap
 * which made it, so the glyph has to be able to say "on". It honours the `selection` axis — `off` is
 * the outline `base`, `on` is the same silhouette FILLED. One path, identical length and commands,
 * so the two variants morph rather than crossfade (`geometryMorphable` → true).
 *
 * Imported from the foundry workbench (which knows only the static outline); the declaration is the
 * source of truth — edit here, do not regenerate.
 */
export const Star: ElementDeclaration = {
  id: 'xeno.star',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: ['selection'], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M12 3.6l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.8l5.9-.8z' },
    ],
    'selection:on': [
      { kind: 'path', d: 'M12 3.6l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.8l5.9-.8z', fill: 'foreground' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Star' },
  meta: { tags: ['favorite', 'rate'], since: '0.1.0' },
}

export default Star

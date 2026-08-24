import type { ElementDeclaration } from '../schema'

/**
 * `xeno.brain` — Thinking. A degenerate element (pure geometry, no children).
 *
 * The set is built out of the rounded square, and this is one of the few things in it that cannot be:
 * a brain has no straight edge anywhere. So it joins `zap`, `waves` and `feather` in the small group
 * allowed to refuse the grid — the rule the grammar actually holds to is that a shape's construction
 * should match what the shape IS, and the square is a claim about made objects.
 *
 * TWO strokes, and that number was arrived at by drawing more. The first version had convolutions inside
 * the lobes — the folds are, after all, the thing that makes brain tissue look like brain tissue. At
 * 96px they read; at 16px, which is every size this glyph is actually used at in the chat, they closed
 * up into a smudge and the outline lost its shape behind them. A bump has to be wider than the stroke
 * that draws it, and a 15-unit outline at 1.75 has room for the lobes OR the folds, not both.
 *
 * What survives is the SULCUS: one line down the middle, dividing it in two. That single stroke is what
 * separates a brain from a cloud, and it costs nothing at any size — the lobed silhouette says organ,
 * and the division says which one.
 *
 * part[0] = outline, part[1] = sulcus.
 */
export const Brain: ElementDeclaration = {
  id: 'xeno.brain',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      {
        kind: 'path',
        d: 'M12 5.4C10 3.2 6.6 4 6.4 7.2 3.8 8.2 3.6 11.6 5.8 12.8 4.8 15.6 6.8 18 9.6 17.8 10.2 19.4 13.8 19.4 14.4 17.8 17.2 18 19.2 15.6 18.2 12.8 20.4 11.6 20.2 8.2 17.6 7.2 17.4 4 14 3.2 12 5.4Z',
      },
      { kind: 'path', d: 'M12 5.4L12 18.8' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Thinking' },
  meta: { tags: ['brain', 'think', 'reason', 'mind', 'intelligence'], since: '0.2.0' },
}

export default Brain

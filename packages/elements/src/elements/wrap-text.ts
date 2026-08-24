import type { ElementDeclaration } from '../schema'

/**
 * `xeno.wrap-text` - Wrap lines. A degenerate element (pure geometry, no children).
 *
 * Three rules, the middle one running into a hook that turns back and points left: the line that ran out
 * of room and came round. `list`'s rules are the reference for the spacing, so a wrapping paragraph and
 * a list line up when they sit next to each other in a toolbar.
 *
 * part[0] = the three rules, part[1] = the hook, part[2] = its head.
 */
export const WrapText: ElementDeclaration = {
  id: 'xeno.wrap-text',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M4 6.5h16M4 12h11M4 17.5h5.4' },
      { kind: 'path', d: 'M15 12h2.6A2.6 2.6 0 0 1 20.2 14.6 2.6 2.6 0 0 1 17.6 17.2h-5.4' },
      { kind: 'path', d: 'M14 15.4 12.2 17.2 14 19' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Wrap lines' },
  meta: { tags: ['wrap', 'text', 'lines'], since: '0.2.0' },
}

export default WrapText

import type { ElementDeclaration } from '../schema'

/**
 * `xeno.send` — Send. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Send: ElementDeclaration = {
  id: 'xeno.send',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M20 4L3.6 11.3a.5.5 0 0 0 .04.93l6.4 2.1 2.1 6.4a.5.5 0 0 0 .93.04z' },
      { kind: 'path', d: 'M20 4l-9.9 10' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Send' },
  meta: { tags: ['submit', 'paper-plane'], since: '0.1.0' },
}

export default Send

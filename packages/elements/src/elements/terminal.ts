import type { ElementDeclaration } from '../schema'

/**
 * `xeno.terminal` — Terminal. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Terminal: ElementDeclaration = {
  id: 'xeno.terminal',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    // Split the prompt from the cursor so only the cursor can blink — part[0] = window, [1] = ">" prompt,
    // [2] = the cursor/underline.
    base: [
      { kind: 'rect', x: 3.5, y: 4.5, w: 17, h: 15, rx: 1.5 },
      { kind: 'path', d: 'M7.5 9.5l3 2.5-3 2.5' },
      { kind: 'path', d: 'M13 15h4' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Terminal' },
  meta: { tags: ['console', 'shell', 'cli'], since: '0.1.0' },
}

export default Terminal

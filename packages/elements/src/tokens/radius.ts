/**
 * Radius scale (px) — the LOCKED XENO grammar: rounded squares, never circles. Values are verbatim
 * from the approved chat design-lab (`xeno-response-lab.html`), see `docs/chat-inventory.md`.
 *
 * DATA: a renderer resolves a radius *role* to these px. The 6/7/8/9 "controls" cluster in the lab is
 * collapsed here to a single `control = 8` (proposal — revise if the finer steps prove necessary).
 */
export const radius = {
  /** list bullets, diagram dots — drawn as tiny squares */
  hair: 1.5,
  /** avatar / thinking cube */
  xs: 3,
  /** badge, checkbox / checklist box, source favicon */
  sm: 5,
  /** overlay chrome ("6px throughout"), code-tool button, inline code */
  md: 6,
  /** buttons, chips, icon buttons, segmented, action-bar */
  control: 8,
  /** cards: code / diagram / artifact / embed / generated-image / preview / attachment */
  card: 12,
} as const

export type RadiusToken = keyof typeof radius

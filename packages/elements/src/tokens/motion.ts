/**
 * Motion tokens — the chat's LOCKED motion language distilled to data (audit of the XENO chat UI).
 *
 * Rules the renderers already enforce: animate `transform`/`opacity` only (never layout), and honour
 * `prefers-reduced-motion` everywhere. These tokens are the vocabulary of curves, durations and the
 * per-item stagger those animations use — resolved to CSS custom properties in `xeno-theme.css`.
 */

/** Easing curves, by role. `base` is the design-system E1; the rest are the chat lab's E2–E5. */
export const easing = {
  /** E1 — reveal / grow. The default (`--xeno-ease`). */
  base: 'cubic-bezier(0.22, 1, 0.36, 1)',
  /** E2 — staggered list items, interaction feedback. */
  stagger: 'cubic-bezier(0.22, 0.7, 0.2, 1)',
  /** E3 — drawers, collapses. */
  drawer: 'cubic-bezier(0.32, 0.72, 0, 1)',
  /** E4 — ease-out-expo, slide-in panels + switches. */
  expo: 'cubic-bezier(0.16, 1, 0.3, 1)',
  /** E5 — overshoot spring, opt-in (the answer-cube pop). */
  overshoot: 'cubic-bezier(0.34, 1.4, 0.5, 1)',
} as const

/** Duration ladder, ms. `base` is the micro default (`--xeno-dur`). */
export const duration = {
  fast: 120,
  base: 140,
  /** Reveals + staggered items land here. */
  entrance: 240,
  /** Grow-from-trigger card modals. */
  modal: 420,
} as const

/** Per-item stagger delay, ms — a component multiplies it by the item index. */
export const stagger = 40

export type EasingToken = keyof typeof easing
export type DurationToken = keyof typeof duration

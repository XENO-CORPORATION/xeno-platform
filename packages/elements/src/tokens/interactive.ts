/**
 * Interactive + text tokens — `DESIGN_SYSTEM.md §2`.
 *
 * Monochrome by decision: interactive feedback is **white at varying opacity** — the only accent.
 * Green/red/amber are semantic STATUS only and are not brand/interactive colour. A binding's `fill`/
 * `stroke` may reference these tokens by name; it may never carry a literal colour.
 */

/** Brand accent — white at opacity (§2 Brand Accent). */
export const accent = {
  base: 'rgba(255, 255, 255, 0.15)',
  hover: 'rgba(255, 255, 255, 0.25)',
  secondary: 'rgba(255, 255, 255, 0.10)',
  secondaryHover: 'rgba(255, 255, 255, 0.20)',
} as const

/** Interactive text — menu items, buttons (§2 Interactive text). */
export const text = {
  idle: '#7f7f86',
  hover: '#d8d8de',
  active: '#acacb4',
  hoverBg: 'rgba(169, 169, 177, 0.08)',
} as const

/** Glassmorphism surfaces (§2). */
export const glass = {
  bg: 'rgba(255, 255, 255, 0.05)',
  border: 'rgba(255, 255, 255, 0.1)',
} as const

export type AccentToken = keyof typeof accent
export type TextToken = keyof typeof text
export type GlassToken = keyof typeof glass

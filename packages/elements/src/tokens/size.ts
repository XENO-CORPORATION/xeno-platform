/**
 * Control size scale — the box metrics a `control`/`composite` resolves per size. Heights are the px
 * the chat actually locked (h-6/7/8/9 = 24/28/32/36); Send sits one step below its mic, which the
 * renderer expresses by picking the smaller size, not by a special case.
 *
 * DATA: no CSS here, just the numbers a renderer maps to height/padding/gap/glyph/label.
 */
export interface ControlMetrics {
  /** Box height, px. */
  readonly height: number
  /** Horizontal padding for label buttons, px (icon-only buttons are square, so padX is unused). */
  readonly padX: number
  /** Gap between a leading/trailing glyph and the label, px. */
  readonly gap: number
  /** Glyph size, px. */
  readonly icon: number
  /** Label size, px. */
  readonly font: number
}

export const controlSize = {
  xs: { height: 24, padX: 8, gap: 5, icon: 15, font: 12 },
  sm: { height: 28, padX: 10, gap: 6, icon: 16, font: 13 },
  md: { height: 32, padX: 12, gap: 6, icon: 16, font: 14 },
  lg: { height: 36, padX: 14, gap: 7, icon: 18, font: 14 },
} as const satisfies Record<string, ControlMetrics>

export type ControlSizeToken = keyof typeof controlSize

/**
 * The guaranteed tappable square, px. 44 is Apple's HIG minimum and WCAG 2.1 AAA (2.5.5); Material
 * asks 48. WCAG 2.2's AA floor is only 24, which is a compliance minimum rather than a design target.
 *
 * This is the HIT area, not the visual size — the two are deliberately different. Material's own icon
 * buttons are 24dp of ink inside a 48dp target, and the same separation is what lets a dense interface
 * stay dense under a finger instead of turning into a row of slabs.
 */
export const touchTarget = 44

/**
 * The same scale for a touch surface. Not simply `desktop + 12`: the steps grow where growth buys
 * something and stay put where it does not.
 *
 * `font` at `md` is 16 for a reason that is not taste — iOS Safari ZOOMS the page when a focused input
 * has a font smaller than 16px, so any text field below that makes the whole layout jump the moment it
 * is tapped. `xs` stays in the vocabulary (a dense badge or inline control is still legible on a
 * phone), but at 28px it is well under the 44px target and depends entirely on the hit extension.
 */
export const controlSizeTouch = {
  xs: { height: 28, padX: 10, gap: 6, icon: 16, font: 13 },
  sm: { height: 32, padX: 12, gap: 7, icon: 17, font: 14 },
  md: { height: 40, padX: 16, gap: 8, icon: 20, font: 16 },
  lg: { height: 48, padX: 18, gap: 9, icon: 22, font: 16 },
} as const satisfies Record<ControlSizeToken, ControlMetrics>

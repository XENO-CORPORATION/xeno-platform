import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react'
import { forwardRef } from 'react'
import type { Availability, ElementDeclaration } from '@xenosystem/elements/schema'
import { XenoElement } from '../XenoElement.js'
import { sizeAttr, iconPx, cx, type ControlSizeToken } from './util.js'

/**
 * `<Button>` — the first non-icon element: the `composite` that proves the "an icon is not a different
 * thing from a button" unification (SPEC §3.1). It honours the SAME axes as an icon — `availability`
 * (enabled/disabled/busy) via `data-availability` — and composes an icon into its slot through the very
 * same `<XenoElement>` renderer. Variants and sizes come from the design tokens; behaviour is a plain
 * button (Base UI later).
 */
/**
 * `quiet` is the chrome button: a hairline border at rest, muted ink, and it comes forward only when
 * you reach for it. It is neither of its neighbours — `outline` is bordered but reads at full strength
 * and brightens its BORDER on hover, `ghost` has the right ink and no border at all. The set already
 * held this shape: `danger` is bordered-and-muted with a red hover, and the neutral member of the pair
 * was simply missing, so products wrote it themselves in five lines of utility classes.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'quiet' | 'danger'
export type ButtonEmphasis = 'quiet' | 'outline' | 'solid'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  readonly variant?: ButtonVariant
  readonly size?: ControlSizeToken
  /** Strength within a semantic variant. Primarily distinguishes destructive confirmation from chrome. */
  readonly emphasis?: ButtonEmphasis
  /** A glyph before the label — imported per-id from `@xenosystem/elements`. */
  readonly leadingIcon?: ElementDeclaration
  /** A glyph after the label. */
  readonly trailingIcon?: ElementDeclaration
  /** Override the size-token glyph measurement without changing the control box. */
  readonly iconSize?: number
  /** Reveal the named icon from beneath the label on hover/focus. `true` means leading. */
  readonly iconReveal?: boolean | 'leading' | 'trailing'
  /** Work in progress — maps to the `busy` availability. */
  readonly busy?: boolean
  /** Play the entrance animation on mount (the locked "send button" appear: fade + slide + scale up). */
  readonly enter?: boolean
  readonly children?: ReactNode
}

/**
 * Ref-forwarding, and it is load-bearing rather than tidy. These buttons anchor things: a popover
 * positions against the one that opened it, a focus-restore puts focus back on it after a dialog
 * closes. On React 19 `ref` is an ordinary prop and a plain function component would pass it through;
 * on React 18 — still inside this package's peer range — `createElement` STRIPS it, so the consumer's
 * `ref.current` stays null and the anchor silently lands at 0,0. Same reasoning as `RadioRow`.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    emphasis = 'quiet',
    leadingIcon,
    trailingIcon,
    iconSize,
    iconReveal = false,
    busy = false,
    enter = false,
    disabled = false,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
): ReactElement {
  const availability: Availability = disabled ? 'disabled' : busy ? 'busy' : 'enabled'
  const glyph = iconSize ?? iconPx(size)
  const revealSide = iconReveal === true ? 'leading' : iconReveal || undefined
  return (
    <button
      ref={ref}
      type={type}
      className={cx('xeno-btn', className)}
      data-variant={variant}
      data-emphasis={emphasis}
      data-availability={availability}
      data-enter={enter ? '' : undefined}
      data-icon-reveal={revealSide}
      disabled={disabled}
      aria-busy={busy || undefined}
      {...sizeAttr(size)}
      {...rest}
    >
      {leadingIcon && <XenoElement decl={leadingIcon} size={glyph} />}
      {revealSide ? <span className="xeno-btn-label">{children}</span> : children}
      {trailingIcon && <XenoElement decl={trailingIcon} size={glyph} />}
    </button>
  )
})

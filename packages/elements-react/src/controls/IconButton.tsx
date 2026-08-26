import type { ButtonHTMLAttributes, ReactElement } from 'react'
import { forwardRef } from 'react'
import type { Availability, ElementDeclaration, ElementState } from '@xenosystem/elements/schema'
import { XenoElement } from '../XenoElement.js'
import { sizeAttr, iconPx, cx, type ControlSizeToken } from './util.js'
import type { ButtonVariant } from './Button.js'

/**
 * `<IconButton>` — a square, icon-only control (the single most-duplicated pattern in the chat, found
 * at 4 sizes × 2 colour families). `aria-label` is REQUIRED because there is no text label. The glyph
 * is a declaration, drawn by the shared renderer, so it inherits the button's monochrome ink.
 */
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  readonly icon: ElementDeclaration
  readonly 'aria-label': string
  readonly variant?: ButtonVariant
  readonly size?: ControlSizeToken
  readonly busy?: boolean
  /** Play the entrance animation on mount (fade + slide + scale up). */
  readonly enter?: boolean
  /**
   * The glyph's px, when the size token's own is not what this control wants.
   *
   * Every other metric a control has — height, padding, gap, font — is a CSS variable that a surface
   * can redefine once at the root. The glyph was the exception: computed in JS from the size token and
   * therefore the one number a consumer could not reach.
   *
   * That gap is what stalled a real adoption. A chat with fifty-one icon buttons drew its glyphs at
   * 13, 14, 15 and 16 px, and this component could offer only the scale's own 15/16/16/18 — so taking
   * the component meant taking a restyle of every one of them in the same commit, with no way to tell
   * afterwards which change someone disliked. A component swap and a resize are two edits and belong
   * in two commits.
   *
   * Not an invitation to drift. The set already holds two deliberate exceptions — the chip's remove ×
   * and the model picker's are `glyph - 2` — so the honest thing is a named door rather than a rule
   * that says nobody ever needs one. Omit it and the scale decides, which is what should usually
   * happen.
   */
  readonly iconSize?: number
  /** Discrete state for a morphing or selectable glyph owned by this button. */
  readonly iconState?: Partial<ElementState>
}

/**
 * Ref-forwarding, and it is load-bearing rather than tidy. These buttons anchor things: a popover
 * positions against the one that opened it, a focus-restore puts focus back on it after a dialog
 * closes. On React 19 `ref` is an ordinary prop and a plain function component would pass it through;
 * on React 18 — still inside this package's peer range — `createElement` STRIPS it, so the consumer's
 * `ref.current` stays null and the anchor silently lands at 0,0. Same reasoning as `RadioRow`.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon,
    variant = 'ghost',
    size = 'md',
    busy = false,
    enter = false,
    iconSize,
    iconState,
    disabled = false,
    className,
    type = 'button',
    ...rest
  },
  ref,
): ReactElement {
  const availability: Availability = disabled ? 'disabled' : busy ? 'busy' : 'enabled'
  return (
    <button
      ref={ref}
      type={type}
      className={cx('xeno-btn', 'xeno-icon-btn', className)}
      data-variant={variant}
      data-availability={availability}
      data-enter={enter ? '' : undefined}
      disabled={disabled}
      aria-busy={busy || undefined}
      {...sizeAttr(size)}
      {...rest}
    >
      <XenoElement decl={icon} size={iconSize ?? iconPx(size)} {...(iconState ? { state: iconState } : {})} />
    </button>
  )
})

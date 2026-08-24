import type { HTMLAttributes, ReactElement, ReactNode } from 'react'
import type { ElementDeclaration } from '@xenosystem/elements/schema'
import { XenoElement } from '../XenoElement.js'
import { cx } from '../controls/util.js'
import Alert from '@xenosystem/elements/elements/alert'

/**
 * `<Callout>` — a left-ruled aside for markdown blockquotes. A 2px rule, `14px` of inset, muted italic
 * ink — the quiet, set-apart voice. The `danger` tone is the one place a hue is allowed: the rule (and
 * the glyph, if there is one) swaps to `--xeno-danger`. `data-tone` on the root is the CSS seam.
 *
 * ## Why `danger` gets a glyph and `default` does not
 *
 * A default callout is an aside — a quieter voice inside the prose — and stamping a mark on it changes
 * what it is. A danger callout is the opposite: its whole job is "stop and read this", and a glyph is
 * the fastest way to say so. So `danger` carries `xeno.alert` unless told otherwise, `default` carries
 * nothing unless asked, and either can be overridden with `icon`.
 */
export type CalloutTone = 'default' | 'danger'

export interface CalloutProps extends Omit<HTMLAttributes<HTMLQuoteElement>, 'children'> {
  readonly children?: ReactNode
  /** `danger` recolours the rule and glyph to `--xeno-danger`; otherwise the block stays monochrome. */
  readonly tone?: CalloutTone
  /**
   * A glyph before the text. Defaults to `xeno.alert` on the `danger` tone and to none otherwise; pass
   * `false` to suppress the danger default, or a declaration to set your own on either tone.
   */
  readonly icon?: ElementDeclaration | false
  /**
   * Play the entrance on mount: the rule draws down from the top while the text arrives behind it.
   * Opt-in, the same way `<Button enter>` is — a page of callouts rendered at once should not all
   * animate themselves into existence, but a single one that has just SURFACED should.
   */
  readonly enter?: boolean
}

/** Glyph px — sized against the italic body text, not the 24px grid. */
const GLYPH_PX = 15

export function Callout({
  children,
  tone = 'default',
  icon,
  enter = false,
  className,
  ...rest
}: CalloutProps): ReactElement {
  const glyph = icon === false ? undefined : (icon ?? (tone === 'danger' ? Alert : undefined))

  return (
    <blockquote
      className={cx('xeno-callout', className)}
      data-tone={tone}
      data-icon={glyph !== undefined ? '' : undefined}
      data-enter={enter ? '' : undefined}
      {...rest}
    >
      {/* Without a glyph the children stay direct descendants, so a blockquote of `<p>`s lays out
          exactly as it always did; the flex row only appears when there is something to sit beside. */}
      {glyph !== undefined && (
        <span className="xeno-callout-icon" aria-hidden="true">
          <XenoElement decl={glyph} size={GLYPH_PX} />
        </span>
      )}
      {glyph !== undefined ? <div className="xeno-callout-body">{children}</div> : children}
    </blockquote>
  )
}

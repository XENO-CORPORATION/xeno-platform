import type { CSSProperties, ReactElement, TextareaHTMLAttributes } from 'react'
import { cx } from './util.js'

/**
 * `<Textarea>` — a multi-line field (card-radius, transparent-ish, focus tightens the border). The base
 * of the chat composer; the full composer (tool rail + action row) is a Tier-2 container built on top.
 */
export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'style'> {
  /** Override only the field type size while retaining its box geometry. */
  readonly fontSize?: number
  /** Use the platform monospace stack for code-oriented editing. */
  readonly mono?: boolean
}

export function Textarea({ disabled = false, className, fontSize, mono = false, ...rest }: TextareaProps): ReactElement {
  return (
    <textarea
      className={cx('xeno-textarea', className)}
      data-availability={disabled ? 'disabled' : 'enabled'}
      data-mono={mono ? '' : undefined}
      style={fontSize === undefined ? undefined : ({ '--xeno-font': `${fontSize}px` } as CSSProperties)}
      disabled={disabled}
      {...rest}
    />
  )
}

import type { ReactElement, TextareaHTMLAttributes } from 'react'
import { cx } from './util.js'

/**
 * `<Textarea>` — a multi-line field (card-radius, transparent-ish, focus tightens the border). The base
 * of the chat composer; the full composer (tool rail + action row) is a Tier-2 container built on top.
 */
export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'style'> {}

export function Textarea({ disabled = false, className, ...rest }: TextareaProps): ReactElement {
  return (
    <textarea
      className={cx('xeno-textarea', className)}
      data-availability={disabled ? 'disabled' : 'enabled'}
      disabled={disabled}
      {...rest}
    />
  )
}

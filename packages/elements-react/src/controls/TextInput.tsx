import type { InputHTMLAttributes, ReactElement } from 'react'
import type { ElementDeclaration } from '@xenosystem/elements/schema'
import { XenoElement } from '../XenoElement.js'
import { sizeAttr, iconPx, cx, type ControlSizeToken } from './util.js'

/**
 * `<TextInput>` — a single-line field. With `leadingIcon` set to `xeno.search` it is the SearchInput
 * the chat hand-rolls ~7×. The icon is a declaration drawn by the shared renderer; the field is a bare
 * native `<input>` so the wrapper owns the box and the input owns the text.
 */
export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'style'> {
  readonly size?: ControlSizeToken
  readonly leadingIcon?: ElementDeclaration
}

export function TextInput({
  size = 'md',
  leadingIcon,
  disabled = false,
  className,
  ...rest
}: TextInputProps): ReactElement {
  return (
    <div
      className={cx('xeno-input', className)}
      data-availability={disabled ? 'disabled' : 'enabled'}
      {...sizeAttr(size)}
    >
      {leadingIcon && (
        <span className="xeno-input-icon" aria-hidden="true">
          <XenoElement decl={leadingIcon} size={iconPx(size)} />
        </span>
      )}
      <input className="xeno-input-field" disabled={disabled} {...rest} />
    </div>
  )
}

import type { HTMLAttributes, ReactElement } from 'react'
import { cx } from '../controls/util.js'

/**
 * `<Caret>` — the thin blinking caret that trails streaming text. A hairline `--xeno-text` block that
 * blinks via a CSS keyframe; under `prefers-reduced-motion` it holds solid (the keyframe only attaches
 * under `no-preference`). Purely decorative, so it is `aria-hidden`.
 */
export interface CaretProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {}

export function Caret({ className, ...rest }: CaretProps): ReactElement {
  return <span className={cx('xeno-caret', className)} aria-hidden="true" {...rest} />
}

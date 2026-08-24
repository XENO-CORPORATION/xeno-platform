import type { HTMLAttributes, ReactElement, ReactNode } from 'react'
import { cx } from '../controls/util.js'

/**
 * `<InlineCode>` — a `<code>` run for inline monospace spans inside prose (markdown `` `code` ``).
 *
 * Monochrome by design: a `--xeno-surface` chip, `radius-sm` corners, `2px 6px` padding, and — the
 * reconciliation the app owed — ink at `--xeno-text` rather than the legacy peach. No hue ever appears
 * here; it is pure shell. Wraps rather than overflowing so a long token cannot blow out the line box.
 */
export interface InlineCodeProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  readonly children?: ReactNode
}

export function InlineCode({ children, className, ...rest }: InlineCodeProps): ReactElement {
  return (
    <code className={cx('xeno-inline-code', className)} {...rest}>
      {children}
    </code>
  )
}

import type { HTMLAttributes, ReactElement, ReactNode } from 'react'
import { cx } from '../controls/util.js'

/**
 * `<Panel>` — a section container built to `DESIGN_SYSTEM.md` §3.1 "Panel Structure — Separated
 * Header + Body": a layout-only wrapper holding standalone heading, body and footer slabs, each with
 * its own surface and border, separated by a 4px gap. §3.1 is explicit that they "are NOT merged into
 * a single container."
 *
 * Give the panel a bounded height and the body scrolls on its own (it is a flex column with a
 * `min-height: 0` body).
 *
 * The footer is `space-between`, so two children land dismiss-left / confirm-right — the arrangement
 * the products already use for their dialogs. One child sits left; wrap it in a `<span />` first if it
 * should sit right.
 */
export interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'title'> {
  /** Heading label (a node, so a badge or glyph can ride along). Rendered uppercase per §4. */
  readonly title?: ReactNode
  /** Trailing heading slot — buttons, toggles, a menu. */
  readonly actions?: ReactNode
  /** Footer slab. Symmetric with the heading (§4); two children read as left/right. */
  readonly footer?: ReactNode
  readonly children?: ReactNode
}

export function Panel({
  title,
  actions,
  footer,
  className,
  children,
  ...rest
}: PanelProps): ReactElement {
  const hasHeader = title !== undefined || actions !== undefined
  return (
    <div className={cx('xeno-panel', className)} {...rest}>
      {hasHeader && (
        <div className="xeno-panel-header">
          {title !== undefined && <div className="xeno-panel-title">{title}</div>}
          {actions !== undefined && <div className="xeno-panel-actions">{actions}</div>}
        </div>
      )}
      <div className="xeno-panel-body">{children}</div>
      {footer !== undefined && <div className="xeno-panel-footer">{footer}</div>}
    </div>
  )
}

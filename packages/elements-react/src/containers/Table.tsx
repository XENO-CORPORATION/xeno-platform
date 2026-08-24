import type {
  HTMLAttributes,
  ReactElement,
  ReactNode,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react'
import { cx } from '../controls/util.js'

/**
 * Dense table PRIMITIVES — the thin, purely-presentational wrappers over the native table elements
 * (`table`/`thead`/`tbody`/`tr`/`th`/`td`). They carry only the `xeno-*` classes so the locked table
 * grammar (border-collapse, hairline row rules, muted 600-weight headers, NO zebra striping, NO
 * vertical rules) lives entirely in `table.css`. Compose them by hand, or reach for {@link DataTable}
 * for the column/row convenience. Alignment rides the `data-align` seam; a selected row rides the
 * `selection` axis (`data-selection` + `aria-selected`) — monochrome, never a coloured glow.
 */

/** Cell text alignment — the only three the grammar allows. */
export type ColumnAlign = 'left' | 'center' | 'right'

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  readonly children?: ReactNode
}

export function Table({ className, children, ...rest }: TableProps): ReactElement {
  return (
    <table className={cx('xeno-table', className)} {...rest}>
      {children}
    </table>
  )
}

export interface THeadProps extends HTMLAttributes<HTMLTableSectionElement> {
  readonly children?: ReactNode
}

export function THead({ className, children, ...rest }: THeadProps): ReactElement {
  return (
    <thead className={cx('xeno-thead', className)} {...rest}>
      {children}
    </thead>
  )
}

export interface TBodyProps extends HTMLAttributes<HTMLTableSectionElement> {
  readonly children?: ReactNode
}

export function TBody({ className, children, ...rest }: TBodyProps): ReactElement {
  return (
    <tbody className={cx('xeno-tbody', className)} {...rest}>
      {children}
    </tbody>
  )
}

export interface TrProps extends HTMLAttributes<HTMLTableRowElement> {
  /** Presentational selection state — rides the `selection` axis. Omit for a plain row. */
  readonly selected?: boolean
  readonly children?: ReactNode
}

export function Tr({ selected, className, children, ...rest }: TrProps): ReactElement {
  return (
    <tr
      className={cx('xeno-tr', className)}
      data-selection={selected === undefined ? undefined : selected ? 'on' : 'off'}
      aria-selected={selected}
      {...rest}
    >
      {children}
    </tr>
  )
}

export interface ThProps extends Omit<ThHTMLAttributes<HTMLTableCellElement>, 'align'> {
  readonly align?: ColumnAlign
  readonly children?: ReactNode
}

export function Th({ align, scope = 'col', className, children, ...rest }: ThProps): ReactElement {
  return (
    <th className={cx('xeno-th', className)} scope={scope} data-align={align} {...rest}>
      {children}
    </th>
  )
}

export interface TdProps extends Omit<TdHTMLAttributes<HTMLTableCellElement>, 'align'> {
  readonly align?: ColumnAlign
  readonly children?: ReactNode
}

export function Td({ align, className, children, ...rest }: TdProps): ReactElement {
  return (
    <td className={cx('xeno-td', className)} data-align={align} {...rest}>
      {children}
    </td>
  )
}

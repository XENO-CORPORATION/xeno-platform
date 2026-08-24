import type { ReactElement, ReactNode, TableHTMLAttributes } from 'react'
import { Table, THead, TBody, Tr, Th, Td, type ColumnAlign } from './Table.js'

/**
 * `<DataTable>` — the column/row convenience over the {@link Table} primitives. Purely presentational:
 * you hand it `columns` (a header, an optional `render`, an optional `align`) and `rows`; it draws the
 * locked dense table for you. A column with no `render` reads `row[column.key]` verbatim. Row identity
 * comes from `getRowKey` (falls back to the index). When `rows` is empty and `empty` is supplied, a
 * single muted, column-spanning cell is drawn instead of an empty body.
 */
export interface DataTableColumn<T> {
  /** Stable column id; also the property read from the row when `render` is absent. */
  readonly key: string
  /** Header cell content. */
  readonly header: ReactNode
  /** Custom cell renderer — overrides the default `row[key]` lookup. */
  readonly render?: (row: T, rowIndex: number) => ReactNode
  /** Cell text alignment for both the header and the column's body cells. */
  readonly align?: ColumnAlign
}

export interface DataTableProps<T> extends Omit<TableHTMLAttributes<HTMLTableElement>, 'children'> {
  readonly columns: readonly DataTableColumn<T>[]
  readonly rows: readonly T[]
  /** Row identity — defaults to the row index. */
  readonly getRowKey?: (row: T, index: number) => string | number
  /** Shown (column-spanning, muted) when `rows` is empty. */
  readonly empty?: ReactNode
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  empty,
  ...rest
}: DataTableProps<T>): ReactElement {
  return (
    <Table {...rest}>
      <THead>
        <Tr>
          {columns.map((col) => (
            <Th key={col.key} {...(col.align !== undefined ? { align: col.align } : {})}>
              {col.header}
            </Th>
          ))}
        </Tr>
      </THead>
      <TBody>
        {rows.length === 0 && empty !== undefined ? (
          <Tr>
            <Td className="xeno-table-empty" colSpan={columns.length}>
              {empty}
            </Td>
          </Tr>
        ) : (
          rows.map((row, rowIndex) => {
            const key = getRowKey ? getRowKey(row, rowIndex) : rowIndex
            return (
              <Tr key={key}>
                {columns.map((col) => {
                  const content: ReactNode = col.render
                    ? col.render(row, rowIndex)
                    : ((row as unknown as Record<string, unknown>)[col.key] as ReactNode)
                  return (
                    <Td key={col.key} {...(col.align !== undefined ? { align: col.align } : {})}>
                      {content}
                    </Td>
                  )
                })}
              </Tr>
            )
          })
        )}
      </TBody>
    </Table>
  )
}

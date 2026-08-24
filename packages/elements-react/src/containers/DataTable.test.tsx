import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { DataTable, type DataTableColumn } from './DataTable.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

interface Person {
  readonly id: number
  readonly name: string
  readonly role: string
}

const rows: Person[] = [
  { id: 1, name: 'Ada', role: 'Engineer' },
  { id: 2, name: 'Alan', role: 'Analyst' },
]

const columns: DataTableColumn<Person>[] = [
  { key: 'name', header: 'Name' },
  { key: 'role', header: 'Role', align: 'right' },
]

describe('DataTable', () => {
  it('draws headers and reads cell values from row[key] by default', () => {
    const out = html(<DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} />)
    expect(out).toContain('class="xeno-table"')
    expect(out).toContain('Name')
    expect(out).toContain('Role')
    expect(out).toContain('Ada')
    expect(out).toContain('Engineer')
    expect(out).toContain('Alan')
    expect(out).toContain('Analyst')
    // The aligned column stamps data-align on its header + body cells.
    expect(out).toContain('data-align="right"')
  })

  it('prefers a column render over the default lookup', () => {
    const cols: DataTableColumn<Person>[] = [
      { key: 'name', header: 'Name', render: (r) => `@${r.name}` },
    ]
    const out = html(<DataTable columns={cols} rows={rows} getRowKey={(r) => r.id} />)
    expect(out).toContain('@Ada')
    expect(out).toContain('@Alan')
  })

  it('renders a column-spanning empty state when there are no rows', () => {
    const out = html(<DataTable columns={columns} rows={[]} empty="No people yet" />)
    expect(out).toContain('xeno-table-empty')
    expect(out).toContain('No people yet')
    expect(out.toLowerCase()).toContain('colspan="2"')
  })

  it('omits the empty cell when rows are present', () => {
    const out = html(<DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} />)
    expect(out).not.toContain('xeno-table-empty')
  })
})

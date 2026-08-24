import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { Table, THead, TBody, Tr, Th, Td } from './Table.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

describe('Table primitives', () => {
  it('renders the table + section + row + cell classes with a scoped header', () => {
    const out = html(
      <Table>
        <THead>
          <Tr>
            <Th>Name</Th>
          </Tr>
        </THead>
        <TBody>
          <Tr>
            <Td>Ada</Td>
          </Tr>
        </TBody>
      </Table>,
    )
    expect(out).toContain('class="xeno-table"')
    expect(out).toContain('class="xeno-thead"')
    expect(out).toContain('class="xeno-tbody"')
    expect(out).toContain('class="xeno-tr"')
    expect(out).toContain('class="xeno-th"')
    expect(out).toContain('class="xeno-td"')
    expect(out).toContain('scope="col"')
    expect(out).toContain('Ada')
  })

  it('reflects the selection axis on a row', () => {
    const on = html(
      <Table>
        <TBody>
          <Tr selected>
            <Td>x</Td>
          </Tr>
        </TBody>
      </Table>,
    )
    expect(on).toContain('data-selection="on"')
    expect(on).toContain('aria-selected="true"')

    const off = html(
      <Table>
        <TBody>
          <Tr selected={false}>
            <Td>x</Td>
          </Tr>
        </TBody>
      </Table>,
    )
    expect(off).toContain('data-selection="off"')

    // A plain row carries neither the axis attribute nor aria-selected.
    const plain = html(
      <Table>
        <TBody>
          <Tr>
            <Td>x</Td>
          </Tr>
        </TBody>
      </Table>,
    )
    expect(plain).not.toContain('data-selection')
    expect(plain).not.toContain('aria-selected')
  })

  it('threads alignment through the data-align seam on both cell kinds', () => {
    const out = html(
      <Table>
        <THead>
          <Tr>
            <Th align="right">Total</Th>
          </Tr>
        </THead>
        <TBody>
          <Tr>
            <Td align="right">42</Td>
          </Tr>
        </TBody>
      </Table>,
    )
    expect(out).toContain('data-align="right"')
  })

  it('merges a custom className onto the table', () => {
    expect(html(<Table className="mine" />)).toContain('class="xeno-table mine"')
  })
})

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import File from '../../../elements/src/elements/file'
import { XenoElement } from '../XenoElement.js'
import { ListRow } from './ListRow.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el)

describe('ListRow', () => {
  it('renders a passive div with title in the body when there is no interaction', () => {
    const out = html(<ListRow title="Inbox" />)
    expect(out).toContain('<div')
    expect(out).toContain('class="xeno-list-row"')
    expect(out).toContain('class="xeno-list-row-body"')
    expect(out).toContain('class="xeno-list-row-title"')
    expect(out).toContain('Inbox')
    // default axes
    expect(out).toContain('data-selection="off"')
    expect(out).toContain('data-availability="enabled"')
    // a passive row is not a tab stop and takes no button role
    expect(out).not.toContain('role="button"')
    expect(out).not.toContain('tabindex')
  })

  it('renders the optional subtitle only when provided', () => {
    expect(html(<ListRow title="Inbox" subtitle="12 unread" />)).toContain('class="xeno-list-row-subtitle"')
    expect(html(<ListRow title="Inbox" />)).not.toContain('xeno-list-row-subtitle')
  })

  it('fills the leading and trailing slots, hiding the leading from AT', () => {
    const out = html(
      <ListRow
        leading={<XenoElement decl={File} size={18} />}
        title="report.pdf"
        trailing={<span>2.1 MB</span>}
      />,
    )
    expect(out).toContain('class="xeno-list-row-leading"')
    expect(out).toContain('aria-hidden="true"')
    expect(out).toContain('<svg') // the glyph is drawn by <XenoElement>
    expect(out).toContain('class="xeno-list-row-trailing"')
    expect(out).toContain('2.1 MB')
  })

  it('becomes a full-width button when given onSelect', () => {
    const out = html(<ListRow title="Run task" onSelect={() => {}} />)
    expect(out).toContain('<button')
    expect(out).toContain('type="button"')
    expect(out).toContain('class="xeno-list-row"')
  })

  it('reflects selection on the selection axis', () => {
    const on = html(<ListRow title="Theme" onSelect={() => {}} selected />)
    expect(on).toContain('data-selection="on"')
    const off = html(<ListRow title="Theme" onSelect={() => {}} selected={false} />)
    expect(off).toContain('data-selection="off"')
  })

  it('reports role=option and aria-selected when option is set', () => {
    const out = html(<ListRow title="Dark" onSelect={() => {}} option selected />)
    expect(out).toContain('role="option"')
    expect(out).toContain('aria-selected="true"')
    const unselected = html(<ListRow title="Light" onSelect={() => {}} option selected={false} />)
    expect(unselected).toContain('aria-selected="false"')
  })

  it('maps disabled onto the availability axis and drops the tab stop', () => {
    const out = html(<ListRow title="Locked" onSelect={() => {}} disabled />)
    expect(out).toContain('data-availability="disabled"')
    expect(out).toContain('disabled')
    expect(out).not.toContain('tabindex')
  })

  it('an interactive div (as="div" + onSelect) gets role=button and a tab stop for the keyboard path', () => {
    const out = html(<ListRow title="Custom" as="div" onSelect={() => {}} />)
    expect(out).toContain('<div')
    expect(out).toContain('role="button"')
    expect(out).toContain('tabindex="0"')
  })

  it('honours an explicit as="button" even without onSelect', () => {
    expect(html(<ListRow title="Static button" as="button" />)).toContain('<button')
  })
})

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import Home from '../../../elements/src/elements/home'
import Star from '../../../elements/src/elements/star'
import Clock from '../../../elements/src/elements/clock'
import { Sidebar, type SidebarItem, type SidebarSection } from './Sidebar.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

const items: SidebarItem[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'starred', label: 'Starred', icon: Star },
  { id: 'plain', label: 'No Icon' },
]

const sections: SidebarSection[] = [
  { heading: 'Recents', items: [{ id: 'r1', label: 'Draft brief', icon: Clock }] },
]

describe('Sidebar', () => {
  it('renders the panel, header, brand, nav landmark, and rows', () => {
    const out = html(<Sidebar open items={items} />)
    expect(out).toContain('class="xeno-sidebar"')
    expect(out).toContain('class="xeno-sidebar-header"')
    expect(out).toContain('class="xeno-sidebar-brand"')
    expect(out).toContain('XENO') // default wordmark
    expect(out).toContain('<nav')
    expect(out).toContain('aria-label="Primary"')
    // one row per item
    expect(out.match(/data-sidebar-item/g)?.length).toBe(3)
    expect(out).toContain('Home')
    expect(out).toContain('No Icon')
  })

  it('reflects the open axis on the panel', () => {
    const open = html(<Sidebar open items={items} />)
    expect(open).toContain('data-state="open"')
    expect(open).not.toContain('inert') // open panel stays in the tab order

    const closed = html(<Sidebar open={false} items={items} />)
    expect(closed).toContain('data-state="closed"')
    expect(closed).toContain('inert') // closed leaves the tab order (inert + aria-hidden)
    expect(closed).toContain('aria-hidden="true"')
  })

  it('marks the active row through the selection axis with aria-current', () => {
    const out = html(<Sidebar open items={items} activeId="starred" />)
    expect(out).toContain('aria-current="page"')
    const rows = out.split('data-sidebar-item')
    expect(rows[1]).toContain('data-selection="off"') // home
    expect(rows[2]).toContain('data-selection="on"') // starred
    expect(rows[3]).toContain('data-selection="off"') // plain, no icon
  })

  it('passes the row selection into a glyph that declares the axis', () => {
    // `star` holds a selection (`on` is the same silhouette filled) and `home` does not. An active
    // row whose icon renders `off` shows a hollow star inside a row that says it is on.
    const active = html(<Sidebar open items={items} activeId="starred" />)
    const starSvg = active.split('data-sidebar-item')[2]
    expect(starSvg).toContain('data-selection="on"')
    // and the glyph follows the row back off
    const inactive = html(<Sidebar open items={items} activeId="home" />)
    expect(inactive.split('data-sidebar-item')[2]).not.toContain('data-selection="on"')
    // a glyph with no selection axis is left alone either way
    expect(active.split('data-sidebar-item')[1]).not.toContain('data-selection="on"')
  })

  it('composes row glyphs via the shared renderer', () => {
    const out = html(<Sidebar open items={items} />)
    expect(out).toContain('<svg') // Home / Star drawn by <XenoElement>
    expect(out).toContain('aria-label="Home"')
    expect(out).toContain('width="18"') // ITEM_ICON px
  })

  it('renders the header search field with the search glyph by default', () => {
    const out = html(<Sidebar open items={items} />)
    expect(out).toContain('xeno-sidebar-search')
    expect(out).toContain('class="xeno-input-field"')
    expect(out).toContain('placeholder="Search"')
    expect(out).toContain('aria-label="Search"')
  })

  it('omits the search field when searchable is false', () => {
    const out = html(<Sidebar open items={items} searchable={false} />)
    expect(out).not.toContain('xeno-sidebar-search')
  })

  it('renders titled sections (Pinned / Recents) with mono-muted headings', () => {
    const out = html(<Sidebar open items={items} sections={sections} />)
    expect(out).toContain('class="xeno-sidebar-heading"')
    expect(out).toContain('Recents')
    expect(out).toContain('Draft brief')
    // main items + section item all render as rows
    expect(out.match(/data-sidebar-item/g)?.length).toBe(4)
  })

  it('renders a footer only when provided', () => {
    expect(html(<Sidebar open items={items} />)).not.toContain('xeno-sidebar-footer')
    const out = html(
      <Sidebar open items={items} footer={<span>emilian@bnkrsys.com</span>} />,
    )
    expect(out).toContain('class="xeno-sidebar-footer"')
    expect(out).toContain('emilian@bnkrsys.com')
  })

  it('renders the backdrop by default and drops it when disabled', () => {
    expect(html(<Sidebar open items={items} />)).toContain('xeno-sidebar-backdrop')
    expect(html(<Sidebar open items={items} backdrop={false} />)).not.toContain(
      'xeno-sidebar-backdrop',
    )
  })

  it('accepts a custom brand node', () => {
    const out = html(<Sidebar open items={items} brand={<b>Pixel</b>} />)
    expect(out).toContain('<b>Pixel</b>')
  })
})

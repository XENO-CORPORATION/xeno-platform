import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import Search from '../../../elements/src/elements/search'
import { Tabs, type TabItem } from './Tabs.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

const items: readonly TabItem[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma', disabled: true },
]

describe('Tabs', () => {
  it('renders a tablist with a tab per item and reflects selection', () => {
    const out = html(<Tabs value="a" items={items} />)
    expect(out).toContain('class="xeno-tabs"')
    expect(out).toContain('class="xeno-tablist"')
    expect(out).toContain('role="tablist"')
    expect(out).toContain('aria-orientation="horizontal"')
    expect(out).toContain('role="tab"')
    expect(out).toContain('Alpha')
    expect(out).toContain('Beta')
    // selected + unselected both render on the selection axis
    expect(out).toContain('aria-selected="true"')
    expect(out).toContain('data-selection="on"')
    expect(out).toContain('aria-selected="false"')
    expect(out).toContain('data-selection="off"')
  })

  it('maps a disabled item to the availability axis', () => {
    const out = html(<Tabs value="a" items={items} />)
    expect(out).toContain('data-availability="disabled"')
    expect(out).toContain('aria-disabled="true"')
  })

  it('emits size metrics straight from the size token', () => {
    expect(html(<Tabs value="a" items={items} size="lg" />)).toContain('data-xeno-size="lg"')
  })

  it('draws a labelled tabpanel for the active value when renderPanel is given', () => {
    const out = html(
      <Tabs value="b" items={items} renderPanel={(v) => <span>panel-{v}</span>} />,
    )
    expect(out).toContain('role="tabpanel"')
    expect(out).toContain('panel-b')
    expect(out).toContain('aria-controls')
    expect(out).toContain('aria-labelledby')
  })

  it('draws a tabpanel from children when renderPanel is absent', () => {
    const out = html(
      <Tabs value="a" items={items}>
        <p>child panel</p>
      </Tabs>,
    )
    expect(out).toContain('role="tabpanel"')
    expect(out).toContain('child panel')
  })

  it('omits the panel entirely when neither renderPanel nor children are given', () => {
    expect(html(<Tabs value="a" items={items} />)).not.toContain('role="tabpanel"')
  })

  it('composes an item icon through the shared renderer', () => {
    const out = html(<Tabs value="a" items={[{ value: 'a', label: 'Find', icon: Search }]} />)
    expect(out).toContain('<svg')
    expect(out).toContain('aria-label="Search"')
    expect(out).toContain('width="16"') // md icon px
  })

  it('renders one shared underline, parked and un-armed until the selection moves', () => {
    const out = html(<Tabs value="b" items={items} />)
    expect(out).toContain('class="xeno-tab-indicator"')
    // exactly one bar for the whole list, not one per tab
    expect(out.match(/xeno-tab-indicator/g)?.length).toBe(1)
    expect(out).toContain('data-index="1"')
    // Measured on the client; SSR hands it a zero width so nothing flashes before layout.
    expect(out).toContain('--xeno-tab-w:0px')
    // Not armed on first paint — the first measurement must not slide the bar in from the left edge.
    expect(out).not.toContain('data-motion')
  })
})

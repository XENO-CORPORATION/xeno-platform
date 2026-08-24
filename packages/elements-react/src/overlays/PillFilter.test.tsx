import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { PillFilter, type PillOption } from './PillFilter.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

const options: readonly PillOption[] = [
  { value: 'open', label: 'Open', count: 12 },
  { value: 'closed', label: 'Closed', count: 30 },
  { value: 'mine', label: 'Mine', disabled: true },
]

describe('PillFilter', () => {
  it('is a multi-select group of pills reflecting the selected values', () => {
    const out = html(<PillFilter value={['open']} options={options} />)
    expect(out).toContain('class="xeno-pillfilter"')
    expect(out).toContain('role="group"')
    expect(out).toContain('class="xeno-pill"')
    // 'open' is on; 'closed' is off — both states render
    expect(out).toContain('aria-pressed="true"')
    expect(out).toContain('data-selection="on"')
    expect(out).toContain('aria-pressed="false"')
    expect(out).toContain('data-selection="off"')
    expect(out).toContain('Open')
  })

  it('renders a count badge when a count is provided', () => {
    const out = html(<PillFilter value={[]} options={options} />)
    expect(out).toContain('class="xeno-pill-count"')
    expect(out).toContain('>12<')
    expect(out).toContain('>30<')
  })

  it('maps a disabled option to the availability axis', () => {
    const out = html(<PillFilter value={[]} options={options} />)
    expect(out).toContain('data-availability="disabled"')
  })

  it('emits size metrics straight from the size token', () => {
    expect(html(<PillFilter value={[]} options={options} size="md" />)).toContain('data-xeno-size="md"')
  })

  it('arms no pill on first paint, so pre-selected pills do not pour in on load', () => {
    expect(html(<PillFilter value={['open', 'closed']} options={options} />)).not.toContain('data-motion')
  })
})

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import Search from '../../../elements/src/elements/search'
import { SegmentedControl, type SegmentedOption } from './SegmentedControl.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

const options: readonly SegmentedOption[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month', disabled: true },
]

describe('SegmentedControl', () => {
  it('is a role=group of aria-pressed options reflecting selection', () => {
    const out = html(<SegmentedControl value="week" options={options} />)
    expect(out).toContain('class="xeno-segmented"')
    expect(out).toContain('role="group"')
    expect(out).toContain('class="xeno-segmented-option"')
    expect(out).toContain('aria-pressed="true"')
    expect(out).toContain('aria-pressed="false"')
    expect(out).toContain('data-selection="on"')
    expect(out).toContain('data-selection="off"')
    expect(out).toContain('Week')
  })

  it('maps a disabled option to the availability axis and disables the button', () => {
    const out = html(<SegmentedControl value="day" options={options} />)
    expect(out).toContain('data-availability="disabled"')
    expect(out).toContain('disabled')
  })

  it('emits size metrics straight from the size token', () => {
    expect(html(<SegmentedControl value="day" options={options} size="sm" />)).toContain('data-xeno-size="sm"')
  })

  it('renders an optional glyph slot at the requested size', () => {
    const out = html(
      <SegmentedControl
        value="day"
        iconSize={14}
        options={[{ value: 'day', label: 'Day', icon: Search }]}
      />,
    )
    expect(out).toContain('data-glyph="search"')
    expect(out).toContain('width="14"')
  })

  it('hands the thumb its count and index so CSS can place it without measuring', () => {
    const out = html(<SegmentedControl value="week" options={options} />)
    expect(out).toContain('class="xeno-segmented-thumb"')
    expect(out).toContain('--xeno-seg-count:3')
    expect(out).toContain('--xeno-seg-index:1') // 'week' is the second option
    expect(out).toContain('data-index="1"')
    // Not armed on first paint — a control that mounts selected must not squash on load.
    expect(out).not.toContain('data-motion')
  })

  it('parks and hides the thumb when the value matches no option', () => {
    const out = html(<SegmentedControl value="nope" options={options} />)
    expect(out).toContain('--xeno-seg-index:0')
    expect(out).not.toContain('data-index=')
    // the track itself carries selection=off, which is what hides the thumb
    expect(out.slice(0, out.indexOf('<button'))).toContain('data-selection="off"')
  })
})

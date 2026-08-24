import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { RadioGroup, RadioRow, type RadioOption } from './RadioGroup.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el)

const opts: readonly RadioOption[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma', disabled: true },
]

describe('RadioGroup', () => {
  it('is a radiogroup of role=radio rows with square markers', () => {
    const out = html(<RadioGroup name="greek" value="b" options={opts} aria-label="Greek" />)
    expect(out).toContain('class="xeno-radiogroup"')
    expect(out).toContain('role="radiogroup"')
    expect(out).toContain('role="radio"')
    expect(out).toContain('xeno-radio-marker')
    expect(out).toContain('xeno-radio-dot')
    expect(out).toContain('Alpha')
    expect(out).toContain('Beta')
    expect(out).toContain('data-orientation="vertical"')
  })

  it('marks only the matching value on', () => {
    const out = html(
      <RadioGroup
        name="g"
        value="a"
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
      />,
    )
    expect(out).toContain('data-selection="on"')
    expect(out).toContain('data-selection="off"')
    // The selected row is aria-checked true.
    expect(out).toContain('aria-checked="true"')
  })

  it('carries the disabled availability onto a disabled option', () => {
    const out = html(<RadioGroup name="greek" value="a" options={opts} />)
    expect(out).toContain('data-availability="disabled"')
  })

  it('honours horizontal orientation and group-level disabled', () => {
    const out = html(<RadioGroup name="g" value="a" options={opts} orientation="horizontal" disabled />)
    expect(out).toContain('data-orientation="horizontal"')
    expect(out).toContain('aria-disabled="true"')
  })
})

describe('RadioRow', () => {
  it('is a standalone role=radio honouring checked', () => {
    const on = html(<RadioRow value="x" checked label="X" />)
    expect(on).toContain('class="xeno-radio"')
    expect(on).toContain('role="radio"')
    expect(on).toContain('aria-checked="true"')
    expect(on).toContain('data-selection="on"')
    expect(on).toContain('xeno-radio-marker')
  })

  it('reflects the off state', () => {
    expect(html(<RadioRow value="x" checked={false} label="X" />)).toContain('data-selection="off"')
  })

  it('does not arm the stamp on first paint, so a pre-chosen group stays still', () => {
    const out = html(<RadioGroup name="greek" value="b" options={opts} aria-label="Greek" />)
    expect(out).not.toContain('data-motion')
  })
})

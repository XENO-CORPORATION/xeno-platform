import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { PickerField } from './PickerField.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el)

describe('PickerField', () => {
  it('renders the trigger with the value and a collapsed, dialog-less field', () => {
    const out = html(
      <PickerField label="Date" value="Aug 15, 2026">
        <div>panel</div>
      </PickerField>,
    )
    expect(out).toContain('class="xeno-field"')
    expect(out).toContain('class="xeno-field-trigger"')
    expect(out).toContain('aria-haspopup="dialog"')
    expect(out).toContain('aria-expanded="false"')
    expect(out).toContain('>Date<')
    expect(out).toContain('Aug 15, 2026')
    // Closed → the panel is not mounted.
    expect(out).not.toContain('role="dialog"')
    expect(out).not.toContain('panel')
  })

  it('falls back to the placeholder, marked as such, when the value is empty', () => {
    const out = html(<PickerField placeholder="Pick a date">{null}</PickerField>)
    expect(out).toContain('data-placeholder="true"')
    expect(out).toContain('Pick a date')
  })

  it('mounts the reveal panel and its content when open', () => {
    const out = html(
      <PickerField label="Time" value="9:30 AM" open>
        <div>the picker</div>
      </PickerField>,
    )
    expect(out).toContain('aria-expanded="true"')
    expect(out).toContain('class="xeno-reveal"')
    expect(out).toContain('xeno-reveal-clip')
    expect(out).toContain('role="dialog"')
    expect(out).toContain('the picker')
  })

  it('merges a className and honours align=end', () => {
    const out = html(
      <PickerField value="x" className="mine" align="end">
        <div>p</div>
      </PickerField>,
    )
    expect(out).toContain('xeno-field mine')
    expect(out).toContain('data-align="end"')
  })
})

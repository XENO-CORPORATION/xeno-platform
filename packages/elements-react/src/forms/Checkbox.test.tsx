import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { Checkbox } from './Checkbox.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el)

describe('Checkbox', () => {
  it('is a role=checkbox with the square box and default off state', () => {
    const out = html(<Checkbox checked={false} label="Remember me" />)
    expect(out).toContain('class="xeno-checkbox"')
    expect(out).toContain('role="checkbox"')
    expect(out).toContain('aria-checked="false"')
    expect(out).toContain('data-selection="off"')
    expect(out).toContain('data-availability="enabled"')
    expect(out).toContain('xeno-checkbox-box')
    expect(out).toContain('Remember me')
    // Off draws no glyph.
    expect(out).not.toContain('<svg')
  })

  it('checked fills the box and stamps the check glyph', () => {
    const out = html(<Checkbox checked label="On" />)
    expect(out).toContain('aria-checked="true"')
    expect(out).toContain('data-selection="on"')
    expect(out).toContain('<svg')
    expect(out).toContain('aria-label="Check"')
  })

  it('mixed maps to the mixed axis and stamps the minus glyph', () => {
    const out = html(<Checkbox checked="mixed" label="Some" />)
    expect(out).toContain('aria-checked="mixed"')
    expect(out).toContain('data-selection="mixed"')
    expect(out).toContain('aria-label="Minus"')
  })

  it('maps disabled to the availability axis', () => {
    const out = html(<Checkbox checked={false} disabled label="x" />)
    expect(out).toContain('data-availability="disabled"')
  })

  it('renders without a label slot when none is given', () => {
    const out = html(<Checkbox checked={false} aria-label="bare" />)
    expect(out).toContain('xeno-checkbox-box')
    expect(out).not.toContain('xeno-checkbox-label')
  })

  it('does not arm the tick on first paint, so a pre-checked form stays still', () => {
    // A box that mounts already ticked must NOT draw itself in on page load.
    expect(html(<Checkbox checked label="On" />)).not.toContain('data-motion')
    expect(html(<Checkbox checked={false} label="Off" />)).not.toContain('data-motion')
  })
})

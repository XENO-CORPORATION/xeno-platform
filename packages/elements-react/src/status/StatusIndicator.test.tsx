import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { StatusIndicator } from './StatusIndicator.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el)

describe('StatusIndicator', () => {
  it('defaults to the neutral tone and carries its label', () => {
    const out = html(<StatusIndicator>Idle</StatusIndicator>)
    expect(out).toContain('class="xeno-statusindicator"')
    expect(out).toContain('data-tone="neutral"')
    expect(out).toContain('class="xeno-statusindicator-mark"')
    expect(out).toContain('class="xeno-statusindicator-label"')
    expect(out).toContain('Idle')
    // neutral injects no tone var
    expect(out).not.toContain('--xeno-status-tone')
  })

  it('marks the square mark aria-hidden', () => {
    const out = html(<StatusIndicator>x</StatusIndicator>)
    expect(out).toContain('aria-hidden="true"')
  })

  it('renders the active tone (monochrome, no injected var)', () => {
    const out = html(<StatusIndicator tone="active">Running</StatusIndicator>)
    expect(out).toContain('data-tone="active"')
    expect(out).not.toContain('--xeno-status-tone')
  })

  it('injects the success status TOKEN as an inline var', () => {
    const out = html(<StatusIndicator tone="success">Live</StatusIndicator>)
    expect(out).toContain('data-tone="success"')
    expect(out).toContain('--xeno-status-tone:#3fb950')
  })

  it('routes danger through the theme token (no inline var)', () => {
    const out = html(<StatusIndicator tone="danger">Down</StatusIndicator>)
    expect(out).toContain('data-tone="danger"')
    expect(out).not.toContain('--xeno-status-tone')
  })

  it('merges a custom className and forwards rest props', () => {
    const out = html(
      <StatusIndicator className="mine" id="s1">
        x
      </StatusIndicator>,
    )
    expect(out).toContain('xeno-statusindicator mine')
    expect(out).toContain('id="s1"')
  })
})

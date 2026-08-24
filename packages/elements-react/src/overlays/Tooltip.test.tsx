import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { Tooltip } from './Tooltip.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

describe('Tooltip', () => {
  it('renders the trigger and a role=tooltip panel whose content is present for SSR', () => {
    const out = html(
      <Tooltip content="Copy to clipboard">
        <button type="button">Copy</button>
      </Tooltip>,
    )
    expect(out).toContain('class="xeno-tooltip"')
    expect(out).toContain('class="xeno-tooltip-panel"')
    expect(out).toContain('role="tooltip"')
    expect(out).toContain('Copy to clipboard') // the hint is in the markup (SSR + a11y)
    expect(out).toContain('<button') // the trigger rendered
  })

  it('defaults to the top side and starts in the closed state', () => {
    const out = html(
      <Tooltip content="Hint">
        <button type="button">x</button>
      </Tooltip>,
    )
    expect(out).toContain('data-side="top"')
    expect(out).toContain('data-state="closed"')
  })

  it('reflects the side prop on both the wrapper and the panel', () => {
    const out = html(
      <Tooltip content="Hint" side="right">
        <button type="button">x</button>
      </Tooltip>,
    )
    const sides = out.match(/data-side="right"/g) ?? []
    expect(sides.length).toBe(2) // wrapper + panel share the axis
  })

  it('wires aria-describedby from the trigger element to the panel id', () => {
    const out = html(
      <Tooltip content="Hint">
        <button type="button">x</button>
      </Tooltip>,
    )
    const panelId = out.match(/role="tooltip" id="([^"]+)"/)?.[1]
    expect(panelId).toBeTruthy()
    expect(out).toContain(`aria-describedby="${panelId}"`)
  })

  it('accepts a plain-text trigger (no aria wiring) and still renders the tooltip panel', () => {
    const out = html(<Tooltip content="Hint">Hover me</Tooltip>)
    expect(out).toContain('Hover me')
    expect(out).toContain('role="tooltip"')
    expect(out).not.toContain('aria-describedby')
  })

  it('renders an aria-hidden pointer arrow', () => {
    const out = html(
      <Tooltip content="Hint" side="bottom">
        <button type="button">x</button>
      </Tooltip>,
    )
    expect(out).toContain('class="xeno-tooltip-arrow"')
    expect(out).toContain('aria-hidden="true"')
  })
})

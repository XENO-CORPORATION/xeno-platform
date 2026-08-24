import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { Spinner } from './Spinner.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

describe('Spinner', () => {
  it('renders a status role with the default Loading label and 16px metrics', () => {
    const out = html(<Spinner />)
    expect(out).toContain('class="xeno-spinner"')
    expect(out).toContain('role="status"')
    expect(out).toContain('aria-label="Loading"')
    expect(out).toContain('aria-live="polite"')
    expect(out).toContain('--xeno-spinner-size:16px')
    expect(out).toContain('--xeno-spinner-stroke:2px')
  })

  it('scales both the edge and the stroke from the size prop', () => {
    const out = html(<Spinner size={32} />)
    expect(out).toContain('--xeno-spinner-size:32px')
    expect(out).toContain('--xeno-spinner-stroke:4px')
  })

  it('accepts a custom label and merges className + rest props', () => {
    const out = html(<Spinner label="Thinking" className="mine" id="s1" />)
    expect(out).toContain('aria-label="Thinking"')
    expect(out).toContain('xeno-spinner mine')
    expect(out).toContain('id="s1"')
  })

  it('falls back to a safe size for a non-positive or non-finite value', () => {
    expect(html(<Spinner size={0} />)).toContain('--xeno-spinner-size:16px')
    expect(html(<Spinner size={Number.NaN} />)).toContain('--xeno-spinner-size:16px')
  })
})

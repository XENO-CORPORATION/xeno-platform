import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { ThinkingCube } from './ThinkingCube.js'

describe('ThinkingCube', () => {
  it('renders the thinking cube: base class, data-state, aria-hidden body, default size var', () => {
    const html = renderToStaticMarkup(<ThinkingCube state="thinking" />)
    expect(html).toContain('xeno-cube')
    expect(html).toContain('data-state="thinking"')
    expect(html).toContain('xeno-cube-body')
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Model is thinking"')
    expect(html).toContain('aria-hidden="true"') // the animated body is decorative
    expect(html).toContain('--xeno-cube-size:24px') // default edge length
  })

  it('renders the settled cube with data-state="settled" and its landed label', () => {
    const html = renderToStaticMarkup(<ThinkingCube state="settled" />)
    expect(html).toContain('data-state="settled"')
    expect(html).toContain('xeno-cube-body')
    expect(html).toContain('aria-label="Answer ready"')
  })

  it('forwards a custom pixel size as the --xeno-cube-size var', () => {
    const html = renderToStaticMarkup(<ThinkingCube state="thinking" size={40} />)
    expect(html).toContain('--xeno-cube-size:40px')
  })

  it('merges a caller className and spreads through extra attributes', () => {
    const html = renderToStaticMarkup(
      <ThinkingCube state="settled" className="mine" data-testid="cube" />,
    )
    expect(html).toContain('xeno-cube mine')
    expect(html).toContain('data-testid="cube"')
  })

  it('lets a caller override the accessible label', () => {
    const html = renderToStaticMarkup(<ThinkingCube state="thinking" aria-label="Reasoning" />)
    expect(html).toContain('aria-label="Reasoning"')
    expect(html).not.toContain('aria-label="Model is thinking"')
  })
})

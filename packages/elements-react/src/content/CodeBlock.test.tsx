import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { CodeBlock } from './CodeBlock.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)
const SAMPLE = 'const x = 1\nconsole.log(x)'

describe('CodeBlock', () => {
  it('renders a canvas card with a language label, code body, and a copy action', () => {
    const out = html(<CodeBlock code={SAMPLE} language="tsx" />)
    expect(out).toContain('class="xeno-code"')
    expect(out).toContain('data-availability="enabled"')
    expect(out).toContain('data-collapsed="false"') // expanded by default
    expect(out).toContain('class="xeno-code-lang"')
    expect(out).toContain('tsx') // uppercased in CSS, verbatim in markup
    expect(out).toContain('<pre')
    expect(out).toContain('console.log(x)')
    expect(out).toContain('aria-label="Copy"')
  })

  it('falls back to a "code" label and omits Run/Collapse when not requested', () => {
    const out = html(<CodeBlock code={SAMPLE} />)
    expect(out).toContain('>code</span>')
    expect(out).not.toContain('aria-label="Run"')
    expect(out).not.toContain('aria-label="Collapse"')
    expect(out).not.toContain('aria-label="Expand"')
    expect(out).not.toContain('xeno-code-summary')
    expect(out).not.toContain('xeno-code-output')
  })

  it('shows a Run action only when onRun is given', () => {
    const out = html(<CodeBlock code={SAMPLE} onRun={() => undefined} />)
    expect(out).toContain('aria-label="Run"')
  })

  it('collapsible + defaultCollapsed folds to an "N lines" summary', () => {
    const out = html(<CodeBlock code={SAMPLE} language="tsx" collapsible defaultCollapsed />)
    expect(out).toContain('data-collapsed="true"')
    expect(out).toContain('aria-label="Expand"')
    expect(out).toContain('aria-expanded="false"')
    expect(out).toContain('class="xeno-code-summary"')
    expect(out).toContain('2 lines')
  })

  it('collapsible but open shows a Collapse toggle and singular "1 line"', () => {
    const open = html(<CodeBlock code={SAMPLE} collapsible />)
    expect(open).toContain('aria-label="Collapse"')
    expect(open).toContain('aria-expanded="true"')
    expect(open).toContain('data-collapsed="false"')

    const single = html(<CodeBlock code="just one line" collapsible defaultCollapsed />)
    expect(single).toContain('1 line')
    expect(single).not.toContain('1 lines')
  })

  it('renders the output panel across all three run states', () => {
    const running = html(<CodeBlock code={SAMPLE} output={{ status: 'running' }} />)
    expect(running).toContain('class="xeno-code-output"')
    expect(running).toContain('data-status="running"')
    expect(running).toContain('Running')

    const ok = html(<CodeBlock code={SAMPLE} output={{ status: 'ok', text: '2\n' }} />)
    expect(ok).toContain('data-status="ok"')
    expect(ok).toContain('xeno-code-output-text')

    const err = html(<CodeBlock code={SAMPLE} output={{ status: 'error', text: 'ReferenceError' }} />)
    expect(err).toContain('data-status="error"')
    expect(err).toContain('ReferenceError')
  })
})

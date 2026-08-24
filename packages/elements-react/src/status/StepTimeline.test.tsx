import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { StepTimeline, type Step } from './StepTimeline.js'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el)

const steps: readonly Step[] = [
  { label: 'Plan', status: 'done', time: '0:01' },
  { label: 'Research', status: 'active', time: '0:04' },
  { label: 'Write', status: 'pending' },
]

describe('StepTimeline', () => {
  it('renders the list root and one step per item with its status axis', () => {
    const out = html(<StepTimeline steps={steps} />)
    expect(out).toContain('class="xeno-steptimeline"')
    expect(out).toContain('data-status="done"')
    expect(out).toContain('data-status="active"')
    expect(out).toContain('data-status="pending"')
    expect(out).toContain('class="xeno-steptimeline-step"')
    expect(out).toContain('Plan')
    expect(out).toContain('Research')
    expect(out).toContain('Write')
  })

  it('stamps the check glyph only on done steps', () => {
    const out = html(<StepTimeline steps={steps} />)
    // exactly one done step → exactly one check svg
    expect(out).toContain('aria-label="Check"')
    expect(out.match(/aria-label="Check"/g)).toHaveLength(1)
  })

  it('renders the mark and threads a spine between marks but not after the last', () => {
    const out = html(<StepTimeline steps={steps} />)
    expect(out).toContain('class="xeno-steptimeline-mark"')
    // 3 steps → 2 connecting spines
    expect(out.match(/class="xeno-steptimeline-spine"/g)).toHaveLength(2)
  })

  it('renders the optional time only when provided, mono/muted', () => {
    const out = html(<StepTimeline steps={steps} />)
    expect(out).toContain('class="xeno-steptimeline-time"')
    expect(out).toContain('0:01')
    expect(out).toContain('0:04')
    // the pending "Write" step carries no time chip
    const timeChips = out.match(/class="xeno-steptimeline-time"/g)
    expect(timeChips).toHaveLength(2)
  })

  it('carries a screen-reader status word for each step', () => {
    const out = html(<StepTimeline steps={steps} />)
    expect(out).toContain('class="xeno-steptimeline-sr"')
    expect(out).toContain('Done')
    expect(out).toContain('In progress')
    expect(out).toContain('Pending')
  })

  it('marks the decorative rail aria-hidden', () => {
    const out = html(<StepTimeline steps={steps} />)
    expect(out).toContain('class="xeno-steptimeline-rail"')
    expect(out).toContain('aria-hidden="true"')
  })

  it('merges a custom className and forwards rest props', () => {
    const out = html(<StepTimeline steps={steps} className="mine" id="t1" />)
    expect(out).toContain('xeno-steptimeline mine')
    expect(out).toContain('id="t1"')
  })

  it('renders an empty list without a spine', () => {
    const out = html(<StepTimeline steps={[]} />)
    expect(out).toContain('class="xeno-steptimeline"')
    expect(out).not.toContain('xeno-steptimeline-spine')
  })
})

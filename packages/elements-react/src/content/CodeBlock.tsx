'use client'

import { useEffect, useId, useRef, useState, type HTMLAttributes, type ReactElement } from 'react'
import { IconButton } from '../controls/IconButton.js'
import { cx } from '../controls/util.js'
import Copy from '@xenosystem/elements/elements/copy'
import Check from '@xenosystem/elements/elements/check'
import ChevronDown from '@xenosystem/elements/elements/chevron-down'
import Terminal from '@xenosystem/elements/elements/terminal'

/**
 * `<CodeBlock>` — a monochrome, self-contained code surface (NO syntax-colour highlighter, by design).
 *
 * Shell is greyscale (canvas card + hairline border); the ink is the code. The header carries an
 * uppercase mono language label and a right-aligned row of icon actions — Copy (with a ~1.5s "copied"
 * confirmation), an optional Collapse toggle, and an optional Run (only when `onRun` is given). A
 * `collapsible` block hides its body behind a "N lines" summary. An optional `output` panel below
 * reports a run: Running… / ok text / error text (the only place a hue — `--xeno-danger` — appears).
 *
 * CSS-first: `data-collapsed` on the root drives body↔summary visibility and the chevron rotation; the
 * transient copied state swaps the glyph to Check and adds `.is-copied`. Behaviour is hand-rolled — the
 * copy timeout is created only inside the handler (never at module scope) and cleared on unmount.
 */
export type CodeBlockOutputStatus = 'running' | 'ok' | 'error'

export interface CodeBlockOutput {
  /** Lifecycle of a run this block triggered. */
  readonly status: CodeBlockOutputStatus
  /** stdout / stderr / result text (omitted while `running`). */
  readonly text?: string
}

export interface CodeBlockProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** The source to display. Rendered verbatim, monochrome, no tokenisation. */
  readonly code: string
  /** Language label, shown uppercased in the header (defaults to `code`). */
  readonly language?: string
  /** When true, the body can fold behind an "N lines" summary. */
  readonly collapsible?: boolean
  /** Initial folded state for a `collapsible` block. */
  readonly defaultCollapsed?: boolean
  /** Show a Run action in the header; called on press. */
  readonly onRun?: () => void
  /** Attach a run-output panel below the body. */
  readonly output?: CodeBlockOutput
}

/** Count of source lines, tolerant of a single trailing newline. */
function countLines(code: string): number {
  if (code === '') return 0
  return code.replace(/\n$/, '').split('\n').length
}

export function CodeBlock({
  code,
  language,
  collapsible = false,
  defaultCollapsed = false,
  onRun,
  output,
  className,
  ...rest
}: CodeBlockProps): ReactElement {
  const [copied, setCopied] = useState(false)
  const [collapsed, setCollapsed] = useState(collapsible ? defaultCollapsed : false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const bodyId = useId()

  // Clear a pending "copied" timeout if the block unmounts first.
  useEffect(() => () => {
    if (timer.current !== undefined) clearTimeout(timer.current)
  }, [])

  /**
   * The acknowledgement waits for the write to actually succeed. Firing it alongside the call meant the
   * glyph swapped to Check and the label announced "Copied" whether or not anything reached the
   * clipboard — and `writeText` rejects routinely: an insecure context, a denied permission, or the
   * very common `NotAllowedError` when the document does not have focus. A control that reports a
   * result it did not get is worse than one that reports nothing.
   */
  const confirm = (): void => {
    setCopied(true)
    if (timer.current !== undefined) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1500)
  }

  const handleCopy = (): void => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    navigator.clipboard.writeText(code).then(confirm, () => {
      // Swallowed on purpose: the failure is already reported by the acknowledgement not appearing,
      // and an unhandled rejection here would surface as a console error the user cannot act on.
    })
  }

  const lines = countLines(code)
  const lineLabel = `${lines} ${lines === 1 ? 'line' : 'lines'}`

  return (
    <div
      className={cx('xeno-code', className)}
      data-collapsed={collapsed ? 'true' : 'false'}
      data-availability="enabled"
      {...rest}
    >
      <div className="xeno-code-header">
        <span className="xeno-code-lang">{language ?? 'code'}</span>
        <div className="xeno-code-actions">
          {onRun && (
            <IconButton
              icon={Terminal}
              aria-label="Run"
              size="xs"
              className="xeno-code-action"
              onClick={onRun}
            />
          )}
          {collapsible && (
            <IconButton
              icon={ChevronDown}
              aria-label={collapsed ? 'Expand' : 'Collapse'}
              size="xs"
              className="xeno-code-action xeno-code-collapse"
              aria-expanded={!collapsed}
              aria-controls={bodyId}
              onClick={() => setCollapsed((c) => !c)}
            />
          )}
          <IconButton
            icon={copied ? Check : Copy}
            aria-label={copied ? 'Copied' : 'Copy'}
            size="xs"
            className={cx('xeno-code-action', 'xeno-code-copy', copied && 'is-copied')}
            onClick={handleCopy}
          />
        </div>
      </div>

      <pre id={bodyId} className="xeno-code-body" tabIndex={0}>
        <code className="xeno-code-code">{code}</code>
      </pre>

      {collapsible && (
        <button
          type="button"
          className="xeno-code-summary"
          aria-controls={bodyId}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(false)}
        >
          {lineLabel}
        </button>
      )}

      {output && (
        <div className="xeno-code-output" data-status={output.status} role="status" aria-live="polite">
          {output.status === 'running' ? (
            <span className="xeno-code-output-running">Running…</span>
          ) : (
            <pre className="xeno-code-output-text">{output.text ?? ''}</pre>
          )}
        </div>
      )}
    </div>
  )
}

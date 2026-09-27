/**
 * The code a chat turn ran with its `run_code` tool — drawn in the reply, under the transcript head,
 * in the order the turn ran it. Claude/ChatGPT parity: the source that ran, what it printed, how it
 * exited, and the files it produced (each a library asset, so it opens again after a reload).
 *
 * ## The states a run passes through
 *
 *   running   the code is executing in the conversation's sandbox — the header shows a spinner and
 *             "Running", the source is already visible (the model wrote it before the wait);
 *   success   it exited 0 — stdout, stderr and any produced files are shown;
 *   error /   it exited non-zero, timed out, was killed, or the engine refused it — the block keeps
 *   timeout   the source and says why, and the model was told the same so it can address it.
 *
 * The run itself is authoritative server-side; this is the presentational record the person watched,
 * folded from the turn's `code` steps (chatTurnTranscript.ts).
 *
 * ⚠️ Colours come from the chat's tokens (`--chat-*`), never literals — this renders in the light,
 * dim and dark palettes.
 */
import React, { useState } from 'react';
import { Terminal, FileText, Download, Copy, Check, ChevronDown, ChevronRight, Loader2 } from '@/lib/icons';
import { libraryService } from '@/services/libraryService';
import type { ChatTurnCodeStep, ChatTurnCodeFile } from './chatTurnTranscript';
import './chatCodeExecution.css';

/** A run as the chat has it: the `code` step from the turn record. `live` says the turn is still open. */
export interface ChatCodeExecutionProps {
  steps: ChatTurnCodeStep[];
  /** The turn is still running — a code step with no end is still executing. */
  live: boolean;
}

/** A human label for a language id — the same set chatCodeTool.js accepts. */
const LANGUAGE_LABELS: Record<string, string> = {
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  go: 'Go',
  rust: 'Rust',
  c: 'C',
  cpp: 'C++',
  java: 'Java',
  ruby: 'Ruby',
  php: 'PHP',
  bash: 'Bash',
};

type RunState = 'running' | 'success' | 'error';

/** The one state a code step is in, from its status/exit/end — the header and styling key off this. */
function runStateOf(step: ChatTurnCodeStep, live: boolean): RunState {
  if (step.endedAt === undefined && step.status !== 'success' && step.status !== 'error' && step.status !== 'timeout' && step.status !== 'killed') {
    return live ? 'running' : 'error'; // an unfinished run on a settled turn never completed
  }
  if (step.error) return 'error';
  if (step.status && step.status !== 'success') return 'error'; // error | timeout | killed
  if (typeof step.exitCode === 'number' && step.exitCode !== 0) return 'error';
  return 'success';
}

/** The header's right-hand summary: a status word, and the exit code once it is known. */
function statusLabel(step: ChatTurnCodeStep, state: RunState): string {
  if (state === 'running') return 'Running';
  if (state === 'error') {
    if (step.status === 'timeout') return 'Timed out';
    if (step.status === 'killed') return 'Stopped';
    if (typeof step.exitCode === 'number') return `Exit ${step.exitCode}`;
    return 'Failed';
  }
  return 'Done';
}

const CopyButton: React.FC<{ text: string; label: string }> = ({ text, label }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="chat-code-copy"
      title={label}
      aria-label={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        }).catch(() => { /* clipboard blocked — no-op, never throw in render path */ });
      }}
    >
      {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
    </button>
  );
};

/**
 * Open a produced file through a signed library link — view in a new tab, or download. A file with no
 * `assetId` was left in the sandbox but never surfaced to the library (best-effort registration), so
 * it is shown as a plain, non-interactive chip: naming it is honest, pretending it downloads is not.
 */
async function openFile(file: ChatTurnCodeFile, download: boolean): Promise<void> {
  if (!file.assetId) return;
  const href = await libraryService.createSignedLink(file.assetId, { download }).catch(() => '');
  if (!href) return;
  if (download) {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = file.path.split('/').pop() || 'file';
    anchor.rel = 'noopener';
    anchor.click();
  } else {
    window.open(href, '_blank', 'noopener');
  }
}

const FileChip: React.FC<{ file: ChatTurnCodeFile }> = ({ file }) => {
  const name = file.path.split('/').pop() || file.path;
  const openable = Boolean(file.assetId);
  return (
    <span className="chat-code-file" data-openable={openable ? 'true' : 'false'}>
      <FileText size={13} aria-hidden="true" className="chat-code-file-icon" />
      {openable ? (
        <button type="button" className="chat-code-file-name" title={file.path} onClick={() => void openFile(file, false)}>
          {name}
        </button>
      ) : (
        <span className="chat-code-file-name chat-code-file-name--static" title={`${file.path} (kept in the sandbox)`}>{name}</span>
      )}
      {openable && (
        <button
          type="button"
          className="chat-code-file-download"
          title="Download"
          aria-label={`Download ${name}`}
          onClick={() => void openFile(file, true)}
        >
          <Download size={12} aria-hidden="true" />
        </button>
      )}
    </span>
  );
};

const CodeRun: React.FC<{ step: ChatTurnCodeStep; live: boolean }> = ({ step, live }) => {
  const state = runStateOf(step, live);
  const [open, setOpen] = useState(true);
  const label = LANGUAGE_LABELS[step.language] || step.language;
  const files = step.files ?? [];
  const hasOutput = Boolean(step.stdout) || Boolean(step.stderr) || Boolean(step.error);

  return (
    <div className="chat-code" data-code-state={state}>
      <div className="chat-code-header">
        <button
          type="button"
          className="chat-code-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          <Terminal size={14} aria-hidden="true" className="chat-code-lang-icon" />
          <span className="chat-code-lang">{label}</span>
        </button>
        <span className="chat-code-status" data-code-state={state}>
          {state === 'running' && <Loader2 size={13} aria-hidden="true" className="chat-code-spin" />}
          {statusLabel(step, state)}
        </span>
      </div>

      {open && (
        <div className="chat-code-body">
          <div className="chat-code-source">
            <CopyButton text={step.code} label="Copy code" />
            <pre className="chat-code-pre"><code>{step.code || ' '}</code></pre>
          </div>

          {hasOutput && (
            <div className="chat-code-output">
              {step.stdout ? (
                <pre className="chat-code-stdout"><code>{step.stdout}</code></pre>
              ) : null}
              {step.stderr ? (
                <pre className="chat-code-stderr"><code>{step.stderr}</code></pre>
              ) : null}
              {step.error ? (
                <div className="chat-code-error" role="note">{step.error}</div>
              ) : null}
            </div>
          )}

          {files.length > 0 && (
            <div className="chat-code-files" aria-label="Files this run produced">
              {files.map((file) => <FileChip key={file.path} file={file} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/** Every run the turn made, in order. Renders nothing for a turn that ran none. */
export const ChatCodeExecution: React.FC<ChatCodeExecutionProps> = ({ steps, live }) => {
  if (!steps.length) return null;
  return (
    <div className="chat-codes" data-chat-code-runs={steps.length}>
      {steps.map((step) => <CodeRun key={step.id} step={step} live={live} />)}
    </div>
  );
};

export default ChatCodeExecution;

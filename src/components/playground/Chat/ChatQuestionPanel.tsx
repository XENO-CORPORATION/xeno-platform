/**
 * The ask_user question panel (2026-10-02) — the card above the composer while the model waits for an
 * answer, plus the one-line record a turn keeps of its question. Ported from the approved preview
 * (orchestrator/previews/chat-question-panel.html). Logic lives in chatQuestion.ts; this only draws it.
 *
 * Keys belong to the PANEL (a listener on it, not on the document), so typing anywhere else never picks
 * an option: ↑/↓ move (single choice selects as it moves, the radio-group rule; select-all moves a
 * highlight and Space toggles), A–F / 1–6 jump, Enter sends, Esc folds — it never skips.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus } from '@/lib/icons';
import type { ChatTurnQuestionStep } from './chatTurnTranscript';
import { optionLetter, type ReadAnswer } from './chatQuestion';
import './chatQuestion.css';

interface PanelProps {
  step: ChatTurnQuestionStep;
  /** Send the answer: the chosen option indices and an optional reason. */
  onAnswer: (picked: number[], reason: string) => void;
  /** The person chose not to answer. */
  onSkip: () => void;
  /** True while a send is in flight, so a double-press cannot answer twice. */
  busy?: boolean;
}

export function ChatQuestionPanel({ step, onAnswer, onSkip, busy = false }: PanelProps) {
  const [picked, setPicked] = useState<number[]>([]);
  const [active, setActive] = useState(-1);
  const [folded, setFolded] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [reason, setReason] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const whyRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const multi = step.multiple;

  // A new question starts clean and takes focus, so its keys work without a click.
  useEffect(() => {
    setPicked([]); setActive(-1); setFolded(false); setShowWhy(false); setReason('');
  }, [step.id, step.question]);
  useEffect(() => {
    if (!folded) panelRef.current?.focus({ preventScroll: true });
  }, [folded, step.id]);
  useEffect(() => { if (showWhy) whyRef.current?.focus(); }, [showWhy]);

  const toggle = (index: number) => {
    setPicked((prev) => (multi ? (prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index].sort((a, b) => a - b)) : [index]));
  };
  const moveTo = (index: number) => {
    setActive(index);
    if (!multi) setPicked([index]);
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  const submit = () => {
    if (busy || picked.length === 0) return;
    onAnswer(picked, reason.trim());
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (event.key === 'Escape') { event.preventDefault(); setFolded(true); return; }
    if (target === whyRef.current) {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
      return;
    }
    const n = step.options.length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const from = active >= 0 ? active : (picked.length ? picked[picked.length - 1] : -1);
      moveTo(event.key === 'Home' ? 0 : event.key === 'End' ? n - 1
        : event.key === 'ArrowDown' ? (from + 1 + n) % n : (from <= 0 ? n - 1 : from - 1));
      return;
    }
    if (event.key === ' ' && multi && active >= 0 && target.tagName !== 'BUTTON') { event.preventDefault(); toggle(active); return; }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    const letter = 'abcdef'.indexOf(key);
    const digit = '123456'.indexOf(key);
    const index = letter !== -1 ? letter : digit;
    if (index !== -1 && index < n) { event.preventDefault(); setActive(index); toggle(index); return; }
    if (event.key === 'Enter' && target === panelRef.current) { event.preventDefault(); submit(); }
  };

  if (folded) {
    return (
      <div className="chat-q" data-chat-question data-folded="true">
        <button type="button" className="chat-q-bar" onClick={() => setFolded(false)} aria-expanded="false">
          <span className="chat-q-sq" aria-hidden="true" />
          <b>Question</b>
          <span className="chat-q-bar-q">{step.question}</span>
          <span className="chat-q-bar-open">Answer</span>
        </button>
      </div>
    );
  }

  return (
    <div ref={panelRef} className="chat-q" data-chat-question tabIndex={-1} role="group" aria-labelledby="chat-q-text" onKeyDown={onKeyDown}>
      <div className="chat-q-head">
        <span className="chat-q-mark" aria-hidden="true"><span className="chat-q-sq" /></span>
        <div className="chat-q-text" id="chat-q-text">
          {step.question}
          {multi && <small>Select all that apply</small>}
        </div>
        <button type="button" className="chat-q-fold" onClick={() => setFolded(true)} aria-label="Fold the question away" title="Fold away (Esc)">
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </div>
      <ul ref={listRef} className="chat-q-list" role={multi ? 'group' : 'radiogroup'} aria-labelledby="chat-q-text">
        {step.options.map((option, index) => (
          <li key={index}>
            <button
              type="button"
              className="chat-q-opt"
              role={multi ? 'checkbox' : 'radio'}
              aria-checked={picked.includes(index)}
              data-active={active === index ? 'true' : undefined}
              data-multi={multi ? 'true' : undefined}
              data-index={index}
              onClick={() => { setActive(index); toggle(index); }}
            >
              <span className="chat-q-key"><span className="chat-q-keyc">{optionLetter(index)}</span></span>
              <span className="chat-q-opt-text">{option}</span>
            </button>
          </li>
        ))}
      </ul>
      {showWhy && (
        <div className="chat-q-why">
          <textarea
            ref={whyRef}
            rows={1}
            value={reason}
            aria-label="Your reasoning"
            placeholder="Why? The model will use your reasoning"
            onChange={(event) => {
              setReason(event.target.value);
              const el = event.target; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
            }}
          />
        </div>
      )}
      <div className="chat-q-foot">
        {!showWhy && (
          <button type="button" className="chat-q-addwhy" onClick={() => setShowWhy(true)}>
            <Plus size={13} aria-hidden="true" />Add your reasoning
          </button>
        )}
        <span className="chat-q-keys">
          <kbd>↑</kbd><kbd>↓</kbd> move{multi ? <> · <kbd>Space</kbd> toggle</> : null} · <kbd>Enter</kbd> send
        </span>
        <button type="button" className="chat-q-btn" data-variant="ghost" onClick={onSkip} disabled={busy}>Skip</button>
        <button type="button" className="chat-q-btn" data-variant="primary" onClick={submit} disabled={busy || picked.length === 0}>Answer</button>
      </div>
    </div>
  );
}

interface RecordProps {
  step: ChatTurnQuestionStep;
  /** How it resolved (from the message that follows), or null while it is still waiting. */
  outcome: ReadAnswer | null;
}

/** The question as the turn keeps it: one line — the question and the answer — that expands on click. */
export function ChatQuestionRecord({ step, outcome }: RecordProps) {
  const [open, setOpen] = useState(false);
  const answer = !outcome ? 'Waiting for your answer'
    : outcome.ownWords ? 'Answered in your own words'
      : outcome.picked.map((i) => `${optionLetter(i)}. ${step.options[i]}`).join(', ');
  return (
    <div className="chat-q-rec" data-open={open ? 'true' : 'false'} data-pending={outcome ? undefined : 'true'} data-chat-question-record>
      <button type="button" className="chat-q-rec-line" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="chat-q-sq" aria-hidden="true" />
        <span className="chat-q-rec-q">{step.question}</span>
        <span className="chat-q-rec-a">{answer}</span>
        <span className="chat-q-rec-chev"><ChevronDown size={14} aria-hidden="true" /></span>
      </button>
      {open && (
        <div className="chat-q-rec-body">
          <div className="chat-q-rec-qq">{step.question}</div>
          <ol>
            {step.options.map((option, index) => (
              <li key={index} data-picked={outcome?.picked.includes(index) ? 'true' : 'false'}>
                <span className="chat-q-key"><span className="chat-q-keyc">{optionLetter(index)}</span></span>
                <span>{option}</span>
              </li>
            ))}
          </ol>
          {outcome?.reason && <div className="chat-q-rec-why"><span>Your reasoning:</span> {outcome.reason}</div>}
        </div>
      )}
    </div>
  );
}

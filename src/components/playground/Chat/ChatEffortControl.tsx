/**
 * The effort control in the web chat's composer — the agent panel's `EffortCells` (LOCKED
 * prototype: the chosen cell opens to hold the word, glides, fuses at the top level) mounted
 * on a chip beside the model selector, in place of the old brain toggle.
 *
 * The toggle was an on/off that meant "send effort=medium" (2026-09-19). The gateway models
 * effort as levels — suffixed ids (`claude-sonnet-5-high`) or a request parameter for the
 * toggleable set — and the server now lists them per model (`Model.efforts`). This control
 * offers exactly those. It renders nothing for a model with no levels: a fixed-reasoning model
 * says "reasons" elsewhere; a non-reasoning model has nothing to choose.
 *
 * D7d: the cells COME from `@xenosystem/agent-conversation`, they are not re-drawn here. The
 * popover is the chat's own (the panel's `XaMenu` is bound to its dock), styled by the same
 * `composer.css` through the `xa-dock` scope and the token bridge in `chat-theme.css`.
 */
import React, { useEffect, useRef, useState } from 'react';
import { EffortCells } from '@xenosystem/agent-conversation/components/agent/composer/EffortCells';
import type { Model, ModelEffortOption } from '@/services/modelService';
import { effortLabel } from './chatReasoningEffort';

export const ChatEffortControl: React.FC<{
  model: Model;
  /** The option in force for this model (`auto` when none was chosen). */
  value: ModelEffortOption;
  onChange: (option: ModelEffortOption) => void;
  disabled?: boolean;
}> = ({ model, value, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const options = model.efforts || [];

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key); };
  }, [open]);

  if (options.length < 2) return null;
  const current = options.find((o) => o.effort === value.effort) || options[0];

  return (
    <div ref={rootRef} data-effort-control className="relative flex items-center">
      <button
        type="button"
        data-effort-trigger
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onMouseDown={(e) => { e.preventDefault(); }}
        onClick={() => setOpen((o) => !o)}
        title="How hard the model thinks before answering"
        className={`flex h-7 items-center gap-1.5 rounded-[10px] border px-2.5 text-xs font-medium transition-[background-color,border-color,color] duration-150 hover:border-[var(--chat-muted)] hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--chat-muted)] ${
          open ? 'border-[var(--chat-muted)] bg-[var(--chat-control)] text-[var(--chat-text)]' : 'border-[var(--chat-border)] bg-transparent text-[var(--chat-muted)]'
        }`}
      >
        <span className="text-[var(--chat-muted)]">Effort</span>
        <span data-effort-current>{effortLabel(current.effort)}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Effort"
          data-effort-menu
          className="xa-dock chat-effort absolute bottom-full left-0 z-30 mb-1.5"
          style={{ position: 'absolute' }} /* composer.css makes .xa-dock relative; the popover must float */
        >
          <div className="xa-menu xa-show" style={{ position: 'relative', width: 224 }}>
            <div className="xa-mrows">
              <EffortCells
                options={options.map((o) => ({ id: o.effort, label: effortLabel(o.effort), title: o.via === 'param' ? `${effortLabel(o.effort)} — sent as the request's reasoning effort` : `${effortLabel(o.effort)} — ${o.modelId}` }))}
                value={current.effort}
                onPick={(id) => {
                  const next = options.find((o) => o.effort === id);
                  if (next) onChange(next);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatEffortControl;

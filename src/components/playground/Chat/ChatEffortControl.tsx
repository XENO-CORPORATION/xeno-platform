/**
 * The effort control in the web chat's composer — the agent panel's `EffortCells` mounted on a pill
 * beside the model name, in the composer's control row (the approved hybrid design: model + effort,
 * one group, no separate Brain button).
 *
 * THINKING ON/OFF IS AN EFFORT. When the caller hands in `thinking`, the cells carry an `Off` level
 * in front of the real ones: picking Off turns thinking off (the auto SKU), picking a level turns it
 * on at that level. So the one control says everything the old Brain toggle + chip pair said, and
 * the pill always shows the state in force — `Off`, or the level. It renders nothing when the model
 * has no level to pick.
 *
 * D7d: the cells COME from `@xenosystem/agent-conversation`, they are not re-drawn here. The
 * popover is the chat's own (the panel's `XaMenu` is bound to its dock), styled by the same
 * `composer.css` through the `xa-dock` scope and the token bridge in `chat-theme.css`.
 */
import React, { useEffect, useRef, useState } from 'react';
import { EffortCells } from '@xenosystem/agent-conversation/components/agent/composer/EffortCells';
import type { Model, ModelEffortOption } from '@/services/modelService';
import { effortLabel } from './chatReasoningEffort';
import { isWorkspaceEmbed, tellWorkspace } from '@/lib/workspaceEmbed';

export const THINKING_OFF_ID = 'off';

export const ChatEffortControl: React.FC<{
  model: Model;
  /** The option in force for this model (`auto` when none was chosen). */
  value: ModelEffortOption;
  onChange: (option: ModelEffortOption) => void;
  /** Thinking on/off, folded in as the `Off` level. Omit for a model whose thinking cannot be turned off. */
  thinking?: { on: boolean; onToggle: () => void };
  disabled?: boolean;
}> = ({ model, value, onChange, thinking, disabled }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const options = (model.efforts || []).filter((o) => o.effort !== 'auto' && o.effort !== 'none');

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

  /*
   * Inside the XENO workspace the effort menu is the workspace's own design, drawn by that page
   * (prototypes/xeno-workspace/app.js: the cells with the level names under them). This control stays
   * the trigger and the LOGIC: a press hands over the real levels and the one in force; a pick comes
   * back as a level id and goes through the same `pick` the chat's own cells call.
   */
  const embedded = isWorkspaceEmbed();
  const pickRef = useRef<(id: string) => void>(() => {});
  useEffect(() => {
    if (!embedded) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const data = event.data as { source?: string; type?: string; id?: string } | null;
      if (!data || data.source !== 'xeno-workspace') return;
      if (data.type === 'effort-menu-closed') setOpen(false);
      if (data.type === 'pick-effort' && typeof data.id === 'string') pickRef.current(data.id);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [embedded]);
  useEffect(() => {
    if (!embedded || !open) return;
    return () => tellWorkspace({ source: 'xeno-chat', type: 'effort-menu-close' });
  }, [embedded, open]);

  if (options.length < 1) return null;
  const current = options.find((o) => o.effort === value.effort) || options[0];
  const isOff = thinking ? !thinking.on : false;
  const shown = isOff ? THINKING_OFF_ID : current.effort;
  const cells = [
    ...(thinking ? [{ id: THINKING_OFF_ID, label: 'Off', title: 'No extended thinking — the model answers straight away' }] : []),
    ...options.map((o) => ({ id: o.effort, label: effortLabel(o.effort), title: o.via === 'param' ? `${effortLabel(o.effort)} — sent as the request's reasoning effort` : `${effortLabel(o.effort)} — ${o.modelId}` })),
  ];
  const pick = (id: string) => {
    if (id === THINKING_OFF_ID) {
      if (thinking?.on) thinking.onToggle();
      return;
    }
    const next = options.find((o) => o.effort === id);
    if (!next) return;
    if (thinking && !thinking.on) thinking.onToggle();
    onChange(next);
  };
  pickRef.current = pick;
  const press = () => {
    if (!embedded) { setOpen((o) => !o); return; }
    if (open) { setOpen(false); return; }
    const r = rootRef.current?.getBoundingClientRect();
    if (!r) return;
    tellWorkspace({
      source: 'xeno-chat',
      type: 'effort-menu',
      rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
      selected: shown,
      levels: cells.map((c) => ({ id: c.id, label: c.label, title: c.title })),
    });
    setOpen(true);
  };

  return (
    <div ref={rootRef} data-effort-control className="relative flex items-center">
      <button
        type="button"
        data-effort-trigger
        data-reason-toggle={thinking ? (isOff ? 'off' : 'on') : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onMouseDown={(e) => { e.preventDefault(); }}
        onClick={press}
        title={isOff ? 'Thinking off — choose how hard the model thinks' : 'How hard the model thinks before answering'}
        className="chat-effort-pill group flex h-[26px] items-center rounded-md px-[5px] text-[10.5px] font-medium leading-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--chat-muted)]"
      >
        <span
          data-effort-current
          className={`rounded-[4px] px-[7px] py-[3px] transition-colors duration-150 ${
            open ? 'bg-[var(--chat-hover)] text-[var(--chat-text)]' : 'bg-[color-mix(in_srgb,var(--chat-text)_4%,transparent)] text-[var(--chat-muted)] group-hover:bg-[var(--chat-hover)] group-hover:text-[var(--chat-text)]'
          }`}
        >
          {isOff ? 'Off' : effortLabel(current.effort)}
        </span>
      </button>
      {open && !embedded && (
        <div
          role="dialog"
          aria-label="Effort"
          data-effort-menu
          className="xa-dock chat-effort absolute bottom-full right-0 z-30 mb-1.5"
          style={{ position: 'absolute' }} /* composer.css makes .xa-dock relative; the popover must float */
        >
          <div className="xa-menu xa-show" style={{ position: 'relative', width: 224 }}>
            <div className="xa-mrows">
              <EffortCells
                options={cells}
                value={shown}
                onPick={pick}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatEffortControl;

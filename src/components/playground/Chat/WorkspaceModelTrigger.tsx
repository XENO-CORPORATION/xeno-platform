/**
 * The model control when the chat is shown inside the XENO workspace (src/lib/workspaceEmbed.ts).
 *
 * The workspace designed its own model menu (prototypes/xeno-workspace/app.js: the compact list with
 * its numbered rows, "More models" and the detail card). That menu is drawn by the workspace page,
 * above this frame, so it can be wider than the composer and is the one implementation of that
 * design. This component is the other half: the trigger in the composer row, and the model LOGIC.
 *
 *   - the list is this chat's real list (the models the account can use, from /api/models);
 *   - a press hands the list, the current model and where the trigger sits to the workspace;
 *   - a pick comes back as a model id and goes through the chat's own `onSelect`, the same call the
 *     chat's own selector makes, so remembering the choice and its side effects are unchanged.
 *
 * Messages from the workspace are accepted only from the parent window of the same origin.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { isOwnKeyRoute, type Model } from '@/services/modelService';
import { tellWorkspace } from '@/lib/workspaceEmbed';

export const WorkspaceModelTrigger: React.FC<{
  models: Model[];
  selected: Model;
  onSelect: (model: Model) => void;
  disabled?: boolean;
  loading?: boolean;
}> = ({ models, selected, onSelect, disabled, loading }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const latest = useRef({ models, onSelect });
  latest.current = { models, onSelect };

  const close = useCallback(() => tellWorkspace({ source: 'xeno-chat', type: 'model-menu-close' }), []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const data = event.data as { source?: string; type?: string; id?: string } | null;
      if (!data || data.source !== 'xeno-workspace') return;
      if (data.type === 'model-menu-closed') setOpen(false);
      if (data.type === 'pick-model' && typeof data.id === 'string') {
        const model = latest.current.models.find((m) => m.id === data.id);
        if (model) latest.current.onSelect(model);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // The menu is in another document, so a press or Escape HERE has to be what closes it.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) close(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key, true); };
  }, [open, close]);

  const toggle = () => {
    if (open) { close(); return; }
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    tellWorkspace({
      source: 'xeno-chat',
      type: 'model-menu',
      rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
      selected: selected.id,
      models: models.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description || '',
        contextWindow: m.contextWindow || 0,
        ownKey: isOwnKeyRoute(m),
      })),
    });
    setOpen(true);
  };

  return (
    <button
      ref={ref}
      type="button"
      data-chat-model-trigger
      className="xm-model apx"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={`Model ${selected.name}`}
      disabled={disabled || loading}
      onMouseDown={(e) => { e.preventDefault(); }}
      onClick={toggle}
    >
      <span className={`ap-txt${open ? ' open' : ''}`} data-part="model" title="Which model answers">
        <span className="ap-model">{loading ? 'Loading models' : selected.name}</span>
      </span>
    </button>
  );
};

export default WorkspaceModelTrigger;

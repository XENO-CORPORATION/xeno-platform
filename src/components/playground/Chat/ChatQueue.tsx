/**
 * The chat's prompt queue, as a card floating above the composer while a chat is running.
 *
 * Presentation only: ChatWithLLM owns the queue (chatQueue.ts) and sends from it. This draws it and
 * reports intents — remove, reorder, edit, attach — and tells the owner when the queue is HELD
 * (someone is editing or rearranging it), because a held queue must not send its next prompt.
 *
 *   - the square beside each prompt is its drag handle (it becomes the grip on hover); the next
 *     prompt's square breathes;
 *   - click a prompt (or its pencil) to edit it; Enter saves, Escape discards, and leaving the field
 *     with an unsaved edit starts a short countdown before it resets — the queue stays held meanwhile;
 *   - a prompt's attachments show as one chip; while editing each can be removed, or more attached.
 *     Attachment changes apply at once (they are uploads, not drafts); only the TEXT is discardable.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, FileText, Layers, Pencil, Plus, X } from '@/lib/icons';
import type { QueueState, QueuedAttachment } from './chatQueueState';
import './chatQueue.css';

export const QUEUE_EDIT_GRACE_SECONDS = 15;

interface ChatQueueProps<F extends QueuedAttachment> {
  queue: QueueState<F>;
  /** Why the queue is not sending right now: a reply is being written, or an attachment is scanning. */
  waiting: 'reply' | 'scanning' | 'ready';
  onToggle: () => void;
  onRemove: (id: string) => void;
  onMove: (from: number, to: number) => void;
  onSaveText: (id: string, text: string) => void;
  onRemoveFile: (id: string, fileId: string) => void;
  onAttach: (id: string) => void;
  /** True while a prompt is being edited or the list is being rearranged. */
  onHoldChange: (held: boolean) => void;
}

const Grip = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="9" cy="6" r="1.3" /><circle cx="15" cy="6" r="1.3" /><circle cx="9" cy="12" r="1.3" />
    <circle cx="15" cy="12" r="1.3" /><circle cx="9" cy="18" r="1.3" /><circle cx="15" cy="18" r="1.3" />
  </svg>
);

function ChatQueueInner<F extends QueuedAttachment>({
  queue, waiting, onToggle, onRemove, onMove, onSaveText, onRemoveFile, onAttach, onHoldChange,
}: ChatQueueProps<F>) {
  const items = queue.messages;
  const expanded = queue.isExpanded;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [graceLeft, setGraceLeft] = useState(0);
  const [dragging, setDragging] = useState(false);
  const graceTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const editBox = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const held = editingId !== null || dragging;
  useEffect(() => { onHoldChange(held); }, [held, onHoldChange]);
  useEffect(() => () => { if (graceTimer.current) clearInterval(graceTimer.current); onHoldChange(false); }, [onHoldChange]);

  // A prompt that was sent (or removed) while being edited ends the edit.
  useEffect(() => {
    if (editingId && !items.some((m) => m.id === editingId)) { clearGrace(); setEditingId(null); }
  }, [items, editingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearGrace = () => { if (graceTimer.current) { clearInterval(graceTimer.current); graceTimer.current = null; } setGraceLeft(0); };
  const endEdit = () => { clearGrace(); setEditingId(null); setEditText(''); };

  const autoGrow = (box: HTMLTextAreaElement | null) => { if (!box) return; box.style.height = 'auto'; box.style.height = `${box.scrollHeight}px`; };
  useEffect(() => {
    if (!editingId) return;
    const box = editBox.current;
    if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); autoGrow(box); }
  }, [editingId]);

  const beginEdit = (id: string) => {
    const it = items.find((m) => m.id === id);
    if (!it) return;
    clearGrace();
    if (!expanded) onToggle();
    setEditingId(id);
    setEditText(it.text);
  };
  const commitEdit = () => { if (editingId) onSaveText(editingId, editText); endEdit(); };
  const discardEdit = () => endEdit();
  const startGrace = () => {
    if (!editingId || graceTimer.current) return;
    setGraceLeft(QUEUE_EDIT_GRACE_SECONDS);
    graceTimer.current = setInterval(() => {
      setGraceLeft((left) => {
        if (left <= 1) { clearGrace(); setEditingId(null); setEditText(''); return 0; }
        return left - 1;
      });
    }, 1000);
  };

  // Drag to reorder: the square is the handle. The lifted row follows the pointer; its neighbours
  // shift to show where it will land; release commits ONE move to the owner.
  const lift = useCallback((event: React.PointerEvent, from: number) => {
    if (editingId || items.length < 2) return;
    const list = listRef.current;
    if (!list) return;
    event.preventDefault();
    const rows = Array.from(list.querySelectorAll<HTMLLIElement>('[data-queue-item]'));
    const rects = rows.map((r) => r.getBoundingClientRect());
    const advance = rects.length > 1 ? rects[1].top - rects[0].top : rects[0].height;
    const row = rows[from];
    const startY = event.clientY;
    let to = from;
    setDragging(true);
    row.dataset.lifted = 'true';
    const target = event.currentTarget as HTMLElement;
    try { target.setPointerCapture(event.pointerId); } catch { /* capture is a nicety */ }
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      row.style.transform = `translateY(${dy}px) scale(1.015)`;
      const center = rects[from].top + rects[from].height / 2 + dy;
      let t = from;
      rects.forEach((r, i) => {
        if (i === from) return;
        const c = r.top + r.height / 2;
        if (i > from && center > c) t = Math.max(t, i);
        if (i < from && center < c) t = Math.min(t, i);
      });
      if (t !== to) {
        to = t;
        rows.forEach((r, i) => {
          if (r === row) return;
          let shift = 0;
          if (to > from && i > from && i <= to) shift = -advance;
          else if (to < from && i < from && i >= to) shift = advance;
          r.style.transform = shift ? `translateY(${shift}px)` : '';
        });
      }
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      rows.forEach((r) => { r.style.transform = ''; delete r.dataset.lifted; });
      setDragging(false);
      if (to !== from) onMove(from, to);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }, [editingId, items.length, onMove]);

  if (items.length === 0) return null;
  const single = items.length === 1;
  const grace = graceLeft > 0;
  const note = grace ? 'Unsaved edit — save to keep it, or it resets'
    : dragging ? 'Rearranging — release to resume'
      : editingId ? 'Paused while you edit — sends when you’re done'
        : waiting === 'scanning' ? 'Waiting for an attachment’s scan'
          : !expanded ? (single ? items[0].text : `Next: ${items[0].text}`)
            : waiting === 'reply' ? 'Sends automatically after this reply' : 'Sending next';
  const count = grace ? `resets in ${graceLeft}s` : held ? 'held' : `1 of ${items.length}`;

  return (
    <div className="chat-queue" data-chat-queue data-expanded={expanded ? 'true' : 'false'} data-held={held ? 'true' : 'false'} data-grace={grace ? 'true' : 'false'}>
      <button type="button" className="chat-queue-bar" data-chat-queue-bar onClick={() => { endEdit(); onToggle(); }}
        aria-expanded={expanded} aria-label={expanded ? 'Collapse queued prompts' : 'Expand queued prompts'}>
        <span className="chat-queue-ico"><Layers size={16} aria-hidden="true" /></span>
        {!single && <><span className="chat-queue-title">Queued</span><span className="chat-queue-vr" aria-hidden="true" /></>}
        {held && <span className="chat-queue-hold" aria-hidden="true" title="Auto-send paused" />}
        <span className="chat-queue-note">{note}</span>
        {(!single || held) && <span className="chat-queue-count tabular-nums">{count}</span>}
        <span className="chat-queue-chev"><ChevronDown size={16} aria-hidden="true" /></span>
      </button>
      <div className="chat-queue-wrap">
        <div className="chat-queue-inner">
          <ul className="chat-queue-list" ref={listRef} aria-label="Queued prompts">
            {items.map((it, i) => {
              const isNext = i === 0;
              const isEditing = editingId === it.id;
              const files = it.attachedFiles;
              return (
                <li key={it.id} className="chat-queue-item" data-queue-item data-next={isNext ? 'true' : 'false'} data-editing={isEditing ? 'true' : undefined}>
                  <span className="chat-queue-mark" data-queue-handle title={items.length > 1 ? 'Drag to reorder' : undefined}
                    onPointerDown={(e) => lift(e, i)} style={{ touchAction: 'none' }}>
                    <span className="chat-queue-sq" aria-hidden="true" />
                    <span className="chat-queue-grip"><Grip /></span>
                  </span>
                  <span className="chat-queue-main">
                    {isEditing ? (
                      <>
                        <textarea
                          ref={editBox}
                          className="chat-queue-edit focus-self focus:border-[var(--chat-text)]"
                          rows={1}
                          value={editText}
                          aria-label="Edit queued prompt"
                          onChange={(e) => { setEditText(e.target.value); autoGrow(e.target); }}
                          onFocus={clearGrace}
                          onBlur={startGrace}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(); }
                            if (e.key === 'Escape') { e.preventDefault(); discardEdit(); }
                          }}
                        />
                        <span className="chat-queue-atts">
                          {files.map((f) => (
                            <span key={f.id} className="chat-queue-att edit" title={f.name}>
                              <FileText size={11} aria-hidden="true" />
                              <span>{f.name}</span>
                              {f.ready === false && <span className="chat-queue-scan" aria-label="Scanning" />}
                              <button type="button" className="chat-queue-att-x" aria-label={`Remove ${f.name}`}
                                onMouseDown={(e) => e.preventDefault()} onClick={() => onRemoveFile(it.id, f.id)}>
                                <X size={9} aria-hidden="true" />
                              </button>
                            </span>
                          ))}
                          <button type="button" className="chat-queue-att add" onMouseDown={(e) => e.preventDefault()} onClick={() => onAttach(it.id)}>
                            <Plus size={11} aria-hidden="true" /><span>Attach</span>
                          </button>
                        </span>
                      </>
                    ) : (
                      <span className="chat-queue-text" data-queue-text role="button" tabIndex={0} title="Click to edit"
                        onClick={() => beginEdit(it.id)} onKeyDown={(e) => { if (e.key === 'Enter') beginEdit(it.id); }}>
                        {it.text}
                        {files.length > 0 && (
                          <span className="chat-queue-att" title={files.map((f) => f.name).join(', ')}>
                            <FileText size={11} aria-hidden="true" />
                            <span>{files.length === 1 ? files[0].name : `${files.length} files`}</span>
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                  <span className="chat-queue-right">
                    <span className="chat-queue-tag">
                      {!single && (isNext ? <span className="chat-queue-next">Next</span> : <span className="chat-queue-n tabular-nums">{i + 1}</span>)}
                    </span>
                    <span className="chat-queue-acts">
                      {isEditing ? (
                        <button type="button" className="chat-queue-b save" aria-label="Save changes" title="Save changes"
                          onMouseDown={(e) => e.preventDefault()} onClick={commitEdit}><Check size={15} aria-hidden="true" /></button>
                      ) : (
                        <button type="button" className="chat-queue-b" aria-label="Edit prompt" title="Edit" onClick={() => beginEdit(it.id)}>
                          <Pencil size={15} aria-hidden="true" />
                        </button>
                      )}
                      <button type="button" className="chat-queue-b del" aria-label="Remove from queue" title="Remove"
                        onMouseDown={(e) => e.preventDefault()} onClick={() => { if (isEditing) endEdit(); onRemove(it.id); }}>
                        <X size={15} aria-hidden="true" />
                      </button>
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

export const ChatQueue = ChatQueueInner as <F extends QueuedAttachment>(props: ChatQueueProps<F>) => React.ReactElement | null;
export default ChatQueue;

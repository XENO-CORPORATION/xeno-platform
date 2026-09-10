import React, { useEffect, useState } from 'react';
import ActionDialog, { type ActionChoice } from './ActionDialog';

/**
 * A promise-based replacement for `confirm()` and `prompt()`.
 *
 * ── WHY THIS SHAPE ────────────────────────────────────────────────────────
 *
 * The obvious conversion is per-component dialog state: a `pendingDelete`, a
 * handler that sets it, another that performs the action, and the dialog in the
 * render tree. That is right where the dialog is part of the screen's design —
 * ProjectsPage and both Studio ProjectManagers do exactly that.
 *
 * But there were 41 remaining call sites across ~25 files, and nearly all are the
 * same guard:
 *
 *     if (!confirm('Delete this?')) return;
 *     ...the actual work...
 *
 * Rewriting each of those into state, a second handler and a render-tree entry is
 * 41 opportunities to change behaviour by accident in files nobody is testing.
 * This preserves the control flow exactly:
 *
 *     if (!(await confirmAction({ title: 'Delete this?', ... }))) return;
 *
 * The line stays a guard, the code after it stays where it was, and the only
 * change is that the caller now awaits.
 *
 * ⚠️ It is NOT a general replacement for a designed dialog. A confirmation that
 * belongs to a screen — with its own copy, its own error handling, its own
 * recovery path — belongs in that screen's tree with ActionDialog directly. This
 * is for the guards.
 */

type Pending = {
  id: number;
  title: string;
  detail: string;
  confirmLabel: string;
  destructive: boolean;
  fieldLabel?: string;
  initialValue?: string;
  choices?: ActionChoice[];
  resolve: (value: string | null) => void;
};

let nextId = 1;
let publish: ((pending: Pending | null) => void) | null = null;
const queue: Pending[] = [];

function enqueue(pending: Pending) {
  queue.push(pending);
  // Only the host can show anything. Without one mounted the promise would never
  // settle and the caller would hang forever on a dialog nobody can see, so an
  // absent host resolves to "cancelled" and says so loudly in development.
  if (!publish) {
    queue.pop();
    if (import.meta.env?.DEV) {
      console.error('[confirmAction] no <ConfirmActionHost /> is mounted — treating as cancelled:', pending.title);
    }
    pending.resolve(null);
    return;
  }
  if (queue.length === 1) publish(pending);
}

/*
 * Settle exactly once per question.
 *
 * ⚠️ This is DEFENCE, not a fix for an observed bug, and the distinction is worth
 * recording because I got it wrong first.
 *
 * ActionDialog calls onClose after a successful onConfirm, so wiring both to
 * settle() looks like it must resolve twice — the second call shifting the queue
 * and handing the NEXT question's caller a null. It does not, because onClose is
 * guarded by `mounted.current`: settling publishes the next question, the `key`
 * changes, React unmounts the old dialog, and the close never fires.
 *
 * So the guard is unexercised today, and scripts/confirm-action.test.mjs CANNOT
 * distinguish its presence — removing it leaves every test green. It stays
 * because that safety depends entirely on the remount, and a later refactor that
 * drops the `key` or reuses the instance would reintroduce the hazard silently.
 * Keying on the id rather than a boolean also means a stale close from a dialog
 * that has already been replaced cannot settle whatever is showing now.
 */
let settledId = 0;

function settle(id: number, value: string | null) {
  if (id === settledId) return;
  if (queue[0]?.id !== id) return;
  settledId = id;
  const current = queue.shift();
  current?.resolve(value);
  publish?.(queue[0] ?? null);
}

/** Ask a yes/no question. Resolves true only on an explicit confirm. */
export function confirmAction(options: {
  title: string; detail: string; confirmLabel?: string; destructive?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => enqueue({
    id: nextId++,
    title: options.title,
    detail: options.detail,
    confirmLabel: options.confirmLabel ?? 'Confirm',
    destructive: options.destructive ?? false,
    resolve: (value) => resolve(value !== null),
  }));
}

/** Ask for a value. Resolves null when cancelled — the same contract as prompt(). */
export function promptAction(options: {
  title: string; detail: string; fieldLabel: string; confirmLabel?: string;
  initialValue?: string; choices?: ActionChoice[]; destructive?: boolean;
}): Promise<string | null> {
  return new Promise((resolve) => enqueue({
    id: nextId++,
    title: options.title,
    detail: options.detail,
    confirmLabel: options.confirmLabel ?? 'Save',
    destructive: options.destructive ?? false,
    fieldLabel: options.fieldLabel,
    initialValue: options.initialValue ?? '',
    choices: options.choices,
    resolve,
  }));
}

/** Mount once, alongside the notification surface. */
export function ConfirmActionHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => {
    publish = setPending;
    return () => { publish = null; };
  }, []);
  if (!pending) return null;
  return <ActionDialog
    key={pending.id}
    title={pending.title}
    detail={pending.detail}
    confirmLabel={pending.confirmLabel}
    destructive={pending.destructive}
    fieldLabel={pending.fieldLabel}
    initialValue={pending.initialValue}
    choices={pending.choices}
    // The work belongs to the caller, which is already holding the promise.
    // Resolving here and letting the caller do its own error handling keeps this
    // host from having an opinion about failures it cannot describe.
    // A confirmation carries no value, so it resolves with '' — non-null, which
    // is what confirmAction reads as "yes". Only a question that ASKED for a
    // value passes one back.
    onConfirm={async (value) => { settle(pending.id, (pending.fieldLabel || pending.choices) ? value : ''); }}
    onClose={() => settle(pending.id, null)}
  />;
}

export default ConfirmActionHost;

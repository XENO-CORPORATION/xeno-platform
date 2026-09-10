import React, { useEffect, useId, useRef, useState } from 'react';
import { Button, Modal, TextInput } from '@xenosystem/elements-react';
import { usePlatformTheme } from '../../platform/platformTheme';

export interface ActionChoice { value: string; label: string }

interface ActionDialogProps {
  title: string;
  detail: string;
  confirmLabel: string;
  destructive?: boolean;
  fieldLabel?: string;
  initialValue?: string;
  /**
   * A closed set of answers, rendered as a radio group.
   *
   * A radio group rather than a <select>: Chrome draws the select popup itself,
   * white, and no CSS reaches it — the same reason xeno-extension had to replace
   * every native select on its dark chrome. A radio group is also the honest
   * semantics for "one of these five", and it is arrow-key navigable for free.
   */
  choices?: ActionChoice[];
  onConfirm: (value: string) => Promise<void>;
  onClose: () => void;
  recovery?: { label: string; onRecover: () => void };
}

/** Business composition only; shared Elements owns appearance and dialog behavior. */
export default function ActionDialog({ title, detail, confirmLabel, destructive = false,
  fieldLabel, initialValue = '', choices, onConfirm, onClose, recovery }: ActionDialogProps) {
  const formId = useId();
  const fieldId = useId();
  const detailId = useId();
  const [value, setValue] = useState(initialValue);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const { resolvedTheme, themeStyle } = usePlatformTheme();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // A choice dialog is invalid until something is chosen; a text dialog until it
  // has non-empty content. A plain confirmation is never invalid.
  const invalid = choices
    ? !choices.some((choice) => choice.value === value)
    : Boolean(fieldLabel && (!value.trim() || value.trim().length > 255));
  const close = () => { if (!inFlight.current) onClose(); };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inFlight.current || invalid || (error && recovery)) return;
    inFlight.current = true;
    // Disabling the focused submit control can send browser focus to the page.
    // Keep it on the shared dialog's existing focus target before disabling.
    event.currentTarget.closest<HTMLElement>('[role="dialog"]')?.focus();
    setPending(true); setError('');
    try {
      await onConfirm(value.trim());
      if (mounted.current) onClose();
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'The operation could not be confirmed.');
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  };

  return <div className="xeno chat-themed" data-theme={resolvedTheme} data-style="industrial" style={themeStyle}>
    <Modal open title={title} onClose={close} dismissDisabled={pending} aria-busy={pending}
      aria-describedby={detailId} footer={<>
        <Button onClick={close} disabled={pending}>Cancel</Button>
        {error && recovery
          ? <Button variant="primary" onClick={recovery.onRecover}>{recovery.label}</Button>
          : <Button variant={destructive ? 'danger' : 'primary'} type="submit" form={formId}
              disabled={pending || invalid} busy={pending}>{pending ? 'Working…' : confirmLabel}</Button>}
      </>}>
      <form id={formId} onSubmit={submit}>
        <p id={detailId}>{detail}</p>
        {choices ? <fieldset disabled={pending} style={{ border: 0, margin: 0, padding: 0 }}>
          {fieldLabel ? <legend>{fieldLabel}</legend> : null}
          {choices.map((choice) => <label key={choice.value} htmlFor={`${fieldId}-${choice.value}`}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' }}>
            <input type="radio" id={`${fieldId}-${choice.value}`} name={fieldId} value={choice.value}
              checked={value === choice.value} disabled={pending}
              onChange={() => setValue(choice.value)} />
            <span>{choice.label}</span>
          </label>)}
        </fieldset> : null}
        {!choices && fieldLabel ? <label htmlFor={fieldId}>{fieldLabel}<TextInput id={fieldId} value={value}
          onChange={event => setValue(event.target.value)} maxLength={255} required disabled={pending} /></label> : null}
        {pending ? <p role="status">Waiting for the server to confirm this operation.</p> : null}
        {error ? <p role="alert">{error}{recovery ? ' Sign in again to check the outcome; revocation was not confirmed.' : ''}</p> : null}
      </form>
    </Modal>
  </div>;
}

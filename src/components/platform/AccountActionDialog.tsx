import React, { useEffect, useId, useRef, useState } from 'react';
import { Button, Modal, TextInput } from '@xenosystem/elements-react';
import { usePlatformTheme } from '../../platform/platformTheme';

interface AccountActionDialogProps {
  title: string;
  detail: string;
  confirmLabel: string;
  destructive?: boolean;
  fieldLabel?: string;
  initialValue?: string;
  onConfirm: (value: string) => Promise<void>;
  onClose: () => void;
  recovery?: { label: string; onRecover: () => void };
}

/** Business composition only; shared Elements owns appearance and dialog behavior. */
export default function AccountActionDialog({ title, detail, confirmLabel, destructive = false,
  fieldLabel, initialValue = '', onConfirm, onClose, recovery }: AccountActionDialogProps) {
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
  const invalid = Boolean(fieldLabel && (!value.trim() || value.trim().length > 255));
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
        {fieldLabel ? <label htmlFor={fieldId}>{fieldLabel}<TextInput id={fieldId} value={value}
          onChange={event => setValue(event.target.value)} maxLength={255} required disabled={pending} /></label> : null}
        {pending ? <p role="status">Waiting for the server to confirm this operation.</p> : null}
        {error ? <p role="alert">{error}{recovery ? ' Sign in again to check the outcome; revocation was not confirmed.' : ''}</p> : null}
      </form>
    </Modal>
  </div>;
}

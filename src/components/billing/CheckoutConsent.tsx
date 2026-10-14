/**
 * The consent step, shown immediately before Stripe.
 *
 * ⚠️ Not decoration and not a dark pattern to be minimised. Under the EU
 * Consumer Rights Directive (§§ 312g, 356 BGB) a digital purchase delivered
 * immediately stays withdrawable for 14 days UNLESS the buyer expressly asks for
 * immediate performance AND acknowledges losing that right. Without this dialog
 * every subscription we sell is refundable on demand for a fortnight, however
 * much of it has been used.
 *
 * 🔴 The wording is FETCHED, never written here. If this component carried its
 * own copy, the page could show one thing while the stored consent recorded
 * another — and a record attesting to text the person never read is worse than
 * no record at all, because it looks like evidence.
 *
 * Two boxes, not three. The first statement is two legal acts (asking for
 * immediate access, and accepting the consequence) which belong in one
 * affirmation because they are one decision — the consequence is meaningless
 * separated from the request. The server still records them as distinct columns,
 * because what was affirmed is a fact about this text, and the text is stored
 * with it.
 */
import React from 'react';
import ChatModal from '../playground/Chat/ChatModal';
import { MarkLoader } from '../platform/MarkLoader';
import { getConsentText, recordConsent } from '../../services/billingService';

interface Props {
  itemId: string;
  planLabel: string;
  priceLabel: string;
  onCancel: () => void;
  /** Called with the consent id once recorded. The caller then starts checkout. */
  onConsented: (consentId: string) => void;
}

const CheckoutConsent: React.FC<Props> = ({ itemId, planLabel, priceLabel, onCancel, onConsented }) => {
  const [lines, setLines] = React.useState<string[] | null>(null);
  const [immediate, setImmediate] = React.useState(false);
  const [terms, setTerms] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let on = true;
    getConsentText().then((c) => {
      if (!on) return;
      /* Falling back to a local paraphrase would defeat the point — if the
       * server cannot tell us the wording, we must not invent it. */
      setLines(c ? c.text.split('\n').filter(Boolean) : []);
    });
    return () => { on = false; };
  }, []);

  const ready = immediate && terms && !busy;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await recordConsent(itemId, {
      immediatePerformance: true,
      withdrawalAcknowledged: true,
      termsAccepted: true,
    });
    if (r.ok && r.consentId) { onConsented(r.consentId); return; }
    setBusy(false);
    setError(r.error || 'Could not record your consent. Nothing has been charged.');
  };

  const unavailable = lines !== null && lines.length === 0;

  return (
    // The platform's ONE dialog (ChatModal, owner 2026-10-14). Only the chrome moved; every word is unchanged.
    <ChatModal
      size="md"
      title="Before you pay"
      onClose={busy ? undefined : onCancel}
      dialogProps={{ 'data-checkout-consent': '' }}
      footer={<>
        <button type="button" className="chat-modal-btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!ready}
          className="chat-modal-btn"
          style={{ background: 'var(--chat-text)', color: 'var(--chat-canvas)', borderColor: 'var(--chat-text)', fontWeight: 600, opacity: ready ? 1 : 0.4 }}
        >
          {busy ? 'Continuing…' : 'Continue to payment'}
        </button>
      </>}
    >
        <p className="text-[13px] text-[#948d83]">
          {planLabel} · {priceLabel}
        </p>

        {lines === null && (
          <div className="mt-6 flex justify-center" role="status">
            <MarkLoader size={48} label="Loading…" />
          </div>
        )}

        {unavailable && (
          <p className="mt-6 rounded-[8px] border border-white/[0.09] bg-white/[0.02] p-4 text-[13px] leading-[1.6] text-[#948d83]">
            We could not load the purchase terms just now, so we will not take a payment.
            Please try again in a moment.
          </p>
        )}

        {lines !== null && lines.length > 0 && (
          <div className="mt-6 space-y-4">
            <label className="flex cursor-pointer gap-3">
              <input
                type="checkbox"
                checked={immediate}
                onChange={(e) => setImmediate(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-white"
              />
              <span className="text-[13px] leading-[1.6] text-[#b6afa5]">
                {lines[0]} {lines[1]}
              </span>
            </label>

            <label className="flex cursor-pointer gap-3">
              <input
                type="checkbox"
                checked={terms}
                onChange={(e) => setTerms(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-white"
              />
              <span className="text-[13px] leading-[1.6] text-[#b6afa5]">
                {lines[2] || 'I accept the Terms of Service.'}{' '}
                <a href="/terms" target="_blank" rel="noreferrer" className="text-[#ece7df] underline underline-offset-2">Terms</a>
                {' · '}
                <a href="/refunds" target="_blank" rel="noreferrer" className="text-[#ece7df] underline underline-offset-2">Refunds</a>
                {' · '}
                <a href="/privacy" target="_blank" rel="noreferrer" className="text-[#ece7df] underline underline-offset-2">Privacy</a>
              </span>
            </label>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-[8px] border border-white/[0.09] bg-white/[0.02] p-3 text-[12.5px] leading-[1.5] text-[#b6afa5]">
            {error}
          </p>
        )}

        {/* Stated plainly rather than buried: someone who does NOT want to waive
            the withdrawal right is entitled to know that is a real option. */}
        <p className="mt-4 text-[11.5px] leading-[1.5] text-[#69635b]">
          Prefer to keep your 14-day withdrawal right? Email support instead of buying here and
          we will arrange delayed access.
        </p>
    </ChatModal>
  );
};

export default CheckoutConsent;

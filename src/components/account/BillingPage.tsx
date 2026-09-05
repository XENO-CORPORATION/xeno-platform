import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, X, Loader2, Sparkles, ExternalLink, Coins, Crown } from 'lucide-react';
import {
  getBillingSummary,
  getBillingConfig,
  getCheckoutStatus,
  openBillingPortal,
  startCheckout,
  type BillingSummary,
  type Entitlements,
  type BillingItem,
} from '../../services/billingService';
import { formatPrice } from '../../config/pricing';
import CheckoutConsent from '../billing/CheckoutConsent';
import ResourceState from '../platform/ResourceState';
import AccountSettingsNav from './AccountSettingsNav';

const ACCENT = 'var(--xeno-theme-text)';

const PLAN_META: Record<string, { label: string; color: string; sub: string }> = {
  free: { label: 'Free', color: ACCENT, sub: 'Your account and web workspace; new desktop installs require a plan' },
  pro:  { label: 'Everything', color: ACCENT,             sub: 'Desktop apps plus paid platform entitlements' },
  team: { label: 'Team', color: ACCENT,                sub: 'Everything plus per-seat collaboration' },
  studio: { label: 'Studio', color: ACCENT,            sub: 'The highest-capacity shipped plan' },
};

function features(e: Entitlements): { label: string; on: boolean }[] {
  return [
    { label: 'Commercial-use license', on: e.commercial },
    { label: 'Cloud sync & multi-device', on: e.cloudSync },
    { label: 'Cross-app layer', on: e.crossApp },
    { label: 'Agent identities', on: e.agents },
    { label: 'Priority managed inference', on: e.priority },
    { label: 'Private cloud projects', on: e.privateProjects },
    { label: 'Real-time collaboration', on: e.collaboration },
  ];
}

const BillingPage: React.FC = () => {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | 'upgrade' | 'manage'>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [packs, setPacks] = useState<BillingItem[]>([]);
  const [upgradeItem, setUpgradeItem] = useState<BillingItem | null>(null);
  const [pendingItem, setPendingItem] = useState<BillingItem | null>(null);
  const [showPacks, setShowPacks] = useState(false);
  const [buyingPack, setBuyingPack] = useState<string | null>(null);
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    try {
      const sessionId = new URLSearchParams(window.location.search).get('session_id');
      // Reconcile the exact purchase before reloading the ledger. A return URL
      // alone never proves payment, and a settled payment can precede its grant.
      const checkout = sessionId ? await getCheckoutStatus(sessionId) : null;
      const [s, cfg] = await Promise.all([getBillingSummary(), getBillingConfig()]);
      if (generation !== loadGeneration.current) return false;
      if (!s) throw new Error('Billing account data is unavailable.');
      setSummary(s);
      if (sessionId) setNotice({ kind: checkout === null || checkout === 'expired' ? 'err' : 'ok', msg:
        checkout === 'fulfilled' ? 'Payment confirmed and your purchase has been applied. Current account details are shown below.' :
        checkout === 'fulfilling' ? 'Payment confirmed. Your purchase is still being applied; refresh billing shortly. Do not pay again.' :
        checkout === 'processing' ? 'Your payment is still processing. Refresh billing to check its status; do not pay again.' :
        checkout === 'expired' ? 'This checkout has expired. No purchase was confirmed for this checkout.' :
        checkout === 'open' ? 'Checkout has not completed. No payment has been confirmed for this checkout.' :
        'We could not verify this checkout. Refresh billing or contact support before trying another purchase.' });
      setPacks((cfg.catalog || []).filter((i) => i.kind === 'credits'));
      setUpgradeItem((cfg.catalog || []).find((i) => i.available && i.kind === 'subscription' && i.plan === 'pro' && i.interval === 'month') || null);
      return true;
    } catch {
      if (generation === loadGeneration.current) { setSummary(null); setPacks([]); setUpgradeItem(null); }
      return false;
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, []);

  // Post-checkout redirect (?billing=success / ?billing=cancel)
  useEffect(() => {
    const b = new URLSearchParams(window.location.search).get('billing');
    let current = true;
    if (b === 'success') {
      load()
        .then(confirmed => {
          if (current && !new URLSearchParams(window.location.search).get('session_id')) setNotice({ kind: confirmed ? 'ok' : 'err', msg: confirmed
            ? 'Checkout returned. Your confirmed account balance and access are shown below. Payment processing may still be pending; refresh to check for updates.'
            : 'Checkout returned, but account data could not be confirmed. Refresh before relying on access.' });
        });
    } else {
      void load();
      if (b === 'cancel') setNotice({ kind: 'err', msg: 'Checkout was canceled. Your current account state is shown below.' });
    }
    return () => { current = false; ++loadGeneration.current; };
  }, [load]);

  const onUpgrade = () => {
    setNotice(null);
    if (upgradeItem) setPendingItem(upgradeItem);
    else setNotice({ kind: 'err', msg: 'Everything is not currently available for purchase.' });
  };
  const onManage = async () => {
    setBusy('manage'); setNotice(null);
    const r = await openBillingPortal();
    if (!r.ok) { setBusy(null); setNotice({ kind: 'err', msg: r.error || 'Could not open billing portal.' }); }
  };

  const availablePacks = packs.filter((p) => p.available);
  const buyPack = (id: string) => {
    setNotice(null);
    const item = availablePacks.find((pack) => pack.id === id);
    if (item) setPendingItem(item);
  };

  const proceedToCheckout = async (item: BillingItem, consentId: string) => {
    setPendingItem(null);
    if (item.kind === 'credits') setBuyingPack(item.id);
    else setBusy('upgrade');
    const r = await startCheckout(item.id, undefined, consentId);
    if (!r.ok) {
      setBusy(null);
      setBuyingPack(null);
      setNotice({ kind: 'err', msg: r.error || 'Could not start checkout.' });
    }
  };

  if (loading) {
    return (
      <div className="xeno-platform-page xeno-billing-loading">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading your plan…
      </div>
    );
  }
  if (!summary) {
    return <main className="xeno-platform-page"><ResourceState kind="error" layout="page" previewLabel="Account / Billing" title="We couldn't load your billing details" detail="No plan or credit information is shown until the billing service confirms it." actionLabel="Try again" onRetry={() => void load()} secondaryActionLabel="Back to dashboard" onSecondaryAction={() => navigate('/overview')} /></main>;
  }

  const plan = summary.plan || 'free';
  const meta = PLAN_META[plan] || PLAN_META.free;
  const isFree = plan === 'free';
  const renew = summary.currentPeriodEnd
    ? new Date(summary.currentPeriodEnd).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  return (
    <>
    {pendingItem && (
      <CheckoutConsent
        itemId={pendingItem.id}
        planLabel={pendingItem.label}
        priceLabel={formatPrice(pendingItem.price, pendingItem.currency)}
        onCancel={() => setPendingItem(null)}
        onConsented={(consentId) => void proceedToCheckout(pendingItem, consentId)}
      />
    )}
    <main className="xeno-platform-page xeno-billing-page xeno-account-page">
      <header className="xeno-platform-page-header"><div><span className="xeno-page-eyebrow">Account</span><h1>Billing &amp; plan</h1><p>Manage your subscription, entitlements, and optional credits.</p></div><button type="button" className="xeno-page-button" onClick={() => void load()}>Refresh billing</button></header>
      <AccountSettingsNav />

      <div className="xeno-billing-content">
      {notice && (
        <div className={notice.kind === 'ok' ? 'xeno-inline-success' : 'xeno-inline-error'} role="status">
          {notice.msg}
        </div>
      )}

      {/* Plan card */}
      <section className="xeno-billing-plan-card">
        <div className="xeno-billing-card-heading">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold" style={{ color: meta.color }}>{meta.label} plan</span>
              {plan === 'pro' && <Crown className="w-4 h-4" style={{ color: meta.color }} />}
              {summary.status === 'past_due' && (
                <span className="xeno-account-status">payment overdue</span>
              )}
              {summary.status === 'canceled' && (
                <span className="xeno-account-status">canceled</span>
              )}
            </div>
            <p className="xeno-billing-subtitle">{meta.sub}</p>
            {renew && !isFree && <p className="xeno-billing-meta">Renews {renew}</p>}
          </div>
          <div className="shrink-0">
            {isFree ? (
              <button onClick={onUpgrade} disabled={busy !== null || buyingPack !== null || !summary.enabled || !upgradeItem}
                className="xeno-page-button is-primary">
                {busy === 'upgrade' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Upgrade to Everything — {upgradeItem ? `${formatPrice(upgradeItem.price, upgradeItem.currency)}/mo` : 'Unavailable'}
              </button>
            ) : (
              <button onClick={onManage} disabled={busy !== null || buyingPack !== null || !summary.enabled}
                className="xeno-page-button">
                {busy === 'manage' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                Manage subscription
              </button>
            )}
          </div>
        </div>

        {/* Entitlements */}
        <div className="xeno-entitlement-grid">
          {features(summary.entitlements).map((f) => (
            <div key={f.label} className="flex items-center gap-2 text-sm">
              {f.on ? <Check className="w-4 h-4 shrink-0" /> : <X className="w-4 h-4 is-muted shrink-0" />}
              <span className={f.on ? '' : 'is-muted'}>{f.label}</span>
            </div>
          ))}
        </div>

        {isFree && (
          <p className="xeno-billing-note">Everything unlocks new desktop installers, paid platform entitlements, commercial rights and priority managed inference.</p>
        )}
      </section>

      {/* Credits card */}
      <section className="xeno-credit-card">
        <div className="xeno-billing-card-heading">
          <div className="flex items-center gap-3">
            <div className="xeno-data-icon">
              <Coins className="w-5 h-5" style={{ color: ACCENT }} />
            </div>
            <div>
              <div className="xeno-billing-meta">Credit balance</div>
              <div className="xeno-credit-balance">
                {summary.credits.toLocaleString()} <span>credits</span>
              </div>
            </div>
          </div>
          <button onClick={() => setShowPacks((v) => !v)} aria-expanded={showPacks} aria-controls="billing-credit-packs"
            className="xeno-page-button">
            {showPacks ? 'Hide' : 'Buy credits'}
          </button>
        </div>

        {showPacks && (
          <div id="billing-credit-packs" className="mt-5 pt-5 border-t" style={{ borderColor: 'var(--xeno-theme-border)' }}>
            {availablePacks.length === 0 ? (
              <p className="xeno-billing-note">Credit purchases are unavailable on this server. Refresh billing to check availability.</p>
            ) : (
              <div className="grid sm:grid-cols-3 gap-3">
                {availablePacks.map((p) => (
                  <button key={p.id} onClick={() => buyPack(p.id)} disabled={buyingPack !== null || busy !== null || !summary.enabled}
                    className="xeno-credit-pack">
                    <div className="text-base font-semibold">{p.credits.toLocaleString()} credits</div>
                    <div className="xeno-billing-meta">{formatPrice(p.price, p.currency)}{p.badge ? ` · ${p.badge}` : ''}</div>
                    <div className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium" style={{ color: ACCENT }}>
                      {buyingPack === p.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {buyingPack === p.id ? 'Redirecting…' : 'Buy →'}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="xeno-billing-note">
          Credits are optional — only for premium (frontier) AI models and the marketplace. Everyday tools on
          your own key or our in-house models don't use credits. Purchased credits never expire.
        </p>
      </section>
      </div>
    </main>
    </>
  );
};

export default BillingPage;

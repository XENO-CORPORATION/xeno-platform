import React, { useEffect, useState, useCallback } from 'react';
import { Check, X, Loader2, Sparkles, ExternalLink, Coins, Crown } from 'lucide-react';
import {
  getBillingSummary,
  getBillingConfig,
  openBillingPortal,
  startCheckout,
  type BillingSummary,
  type Entitlements,
  type BillingItem,
} from '../../services/billingService';
import { formatPrice } from '../../config/pricing';

const ACCENT = '#a760ff';

const PLAN_META: Record<string, { label: string; color: string; sub: string }> = {
  free: { label: 'Free', color: 'rgba(255,255,255,0.65)', sub: 'The full local tool — clean, no watermark, local export' },
  pro:  { label: 'Pro',  color: ACCENT,                   sub: 'The connected Platform — cloud, cross-app, agents' },
  team: { label: 'Team', color: '#4ea1ff',               sub: 'Everything in Pro + collaboration' },
};

function features(e: Entitlements): { label: string; on: boolean }[] {
  return [
    { label: 'Commercial-use license', on: e.commercial },
    { label: 'Cloud sync & multi-device', on: e.cloudSync },
    { label: 'Cross-app workflows', on: e.crossApp },
    { label: 'Agents & automation', on: e.agents },
    { label: 'Priority managed inference', on: e.priority },
    { label: 'Private cloud projects', on: e.privateProjects },
    { label: 'Real-time collaboration', on: e.collaboration },
  ];
}

const BillingPage: React.FC = () => {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | 'upgrade' | 'manage'>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [packs, setPacks] = useState<BillingItem[]>([]);
  const [showPacks, setShowPacks] = useState(false);
  const [buyingPack, setBuyingPack] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, cfg] = await Promise.all([getBillingSummary(), getBillingConfig()]);
    setSummary(s);
    setPacks((cfg.catalog || []).filter((i) => i.kind === 'credits'));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Post-checkout redirect (?billing=success / ?billing=cancel)
  useEffect(() => {
    const b = new URLSearchParams(window.location.search).get('billing');
    if (b === 'success') {
      setNotice({ kind: 'ok', msg: 'Payment complete — your plan is active. 🎉' });
      window.history.replaceState({}, '', window.location.pathname);
      load();
    } else if (b === 'cancel') {
      setNotice({ kind: 'err', msg: 'Checkout canceled — no charge was made.' });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [load]);

  const onUpgrade = async () => {
    setBusy('upgrade'); setNotice(null);
    const r = await startCheckout('pro_monthly');
    if (!r.ok) { setBusy(null); setNotice({ kind: 'err', msg: r.error || 'Could not start checkout.' }); }
  };
  const onManage = async () => {
    setBusy('manage'); setNotice(null);
    const r = await openBillingPortal();
    if (!r.ok) { setBusy(null); setNotice({ kind: 'err', msg: r.error || 'Could not open billing portal.' }); }
  };

  const availablePacks = packs.filter((p) => p.available);
  const buyPack = async (id: string) => {
    setBuyingPack(id); setNotice(null);
    const r = await startCheckout(id);
    if (!r.ok) { setBuyingPack(null); setNotice({ kind: 'err', msg: r.error || 'Could not start checkout.' }); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-white/50">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading your plan…
      </div>
    );
  }
  if (!summary) {
    return <div className="py-16 text-center text-white/50">Couldn't load billing — please refresh.</div>;
  }

  const plan = summary.plan || 'free';
  const meta = PLAN_META[plan] || PLAN_META.free;
  const isFree = plan === 'free';
  const renew = summary.currentPeriodEnd
    ? new Date(summary.currentPeriodEnd).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  return (
    <div className="max-w-3xl mx-auto w-full px-4 py-8 text-white">
      <h1 className="text-2xl font-semibold mb-1">Billing &amp; Plan</h1>
      <p className="text-white/45 text-sm mb-6">Manage your subscription and credits.</p>

      {notice && (
        <div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${notice.kind === 'ok'
          ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
          : 'border-red-400/30 bg-red-400/10 text-red-200'}`}>
          {notice.msg}
        </div>
      )}

      {/* Plan card */}
      <div className="rounded-2xl border border-white/[0.08] bg-black/40 p-6 mb-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold" style={{ color: meta.color }}>{meta.label} plan</span>
              {plan === 'pro' && <Crown className="w-4 h-4" style={{ color: meta.color }} />}
              {summary.status === 'past_due' && (
                <span className="text-[11px] rounded-full bg-amber-400/15 text-amber-300 px-2 py-0.5">payment overdue</span>
              )}
              {summary.status === 'canceled' && (
                <span className="text-[11px] rounded-full bg-white/10 text-white/50 px-2 py-0.5">canceled</span>
              )}
            </div>
            <p className="text-white/45 text-sm mt-1">{meta.sub}</p>
            {renew && !isFree && <p className="text-white/40 text-xs mt-2">Renews {renew}</p>}
          </div>
          <div className="shrink-0">
            {isFree ? (
              <button onClick={onUpgrade} disabled={busy === 'upgrade'}
                className="inline-flex items-center gap-2 rounded-lg bg-white text-black font-semibold text-sm px-4 py-2.5 transition-colors hover:bg-white/90 disabled:opacity-60">
                {busy === 'upgrade' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Upgrade to Pro — €24/mo
              </button>
            ) : (
              <button onClick={onManage} disabled={busy === 'manage'}
                className="inline-flex items-center gap-2 rounded-lg border border-white/15 text-white text-sm px-4 py-2.5 transition-colors hover:border-white/30 disabled:opacity-60">
                {busy === 'manage' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                Manage subscription
              </button>
            )}
          </div>
        </div>

        {/* Entitlements */}
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 mt-5 pt-5 border-t border-white/[0.06]">
          {features(summary.entitlements).map((f) => (
            <div key={f.label} className="flex items-center gap-2 text-sm">
              {f.on ? <Check className="w-4 h-4 text-emerald-400 shrink-0" /> : <X className="w-4 h-4 text-white/25 shrink-0" />}
              <span className={f.on ? 'text-white/80' : 'text-white/35'}>{f.label}</span>
            </div>
          ))}
        </div>

        {isFree && (
          <p className="text-white/35 text-xs mt-4">Pro unlocks the connected Platform — cloud sync, cross-app workflows, agents, commercial rights &amp; priority — for €24/mo.</p>
        )}
      </div>

      {/* Credits card */}
      <div className="rounded-2xl border border-white/[0.08] bg-black/40 p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid place-items-center w-10 h-10 rounded-xl bg-white/[0.06]">
              <Coins className="w-5 h-5" style={{ color: ACCENT }} />
            </div>
            <div>
              <div className="text-sm text-white/50">Credit balance</div>
              <div className="text-xl font-semibold">
                {summary.credits.toLocaleString()} <span className="text-sm font-normal text-white/40">credits</span>
              </div>
            </div>
          </div>
          <button onClick={() => setShowPacks((v) => !v)}
            className="rounded-lg border border-white/15 text-white text-sm px-4 py-2.5 transition-colors hover:border-white/30 shrink-0">
            {showPacks ? 'Hide' : 'Buy credits'}
          </button>
        </div>

        {showPacks && (
          <div className="mt-5 pt-5 border-t border-white/[0.06]">
            {availablePacks.length === 0 ? (
              <p className="text-white/40 text-sm">Top-ups aren't available yet — coming soon.</p>
            ) : (
              <div className="grid sm:grid-cols-3 gap-3">
                {availablePacks.map((p) => (
                  <button key={p.id} onClick={() => buyPack(p.id)} disabled={buyingPack === p.id}
                    className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left transition-colors hover:border-white/25 disabled:opacity-60">
                    <div className="text-base font-semibold">{p.credits.toLocaleString()} credits</div>
                    <div className="text-white/45 text-sm mt-0.5">{formatPrice(p.price, p.currency)}{p.badge ? ` · ${p.badge}` : ''}</div>
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

        <p className="text-white/35 text-xs mt-4">
          Credits are optional — only for premium (frontier) AI models and the marketplace. Everyday tools on
          your own key or our in-house models don't use credits. Purchased credits never expire.
        </p>
      </div>
    </div>
  );
};

export default BillingPage;

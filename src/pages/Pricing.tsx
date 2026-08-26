import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import MarketingPage, { Section, Prose } from '../components/marketing/MarketingPage';
import { PlanCard } from '../components/onboarding/OnboardingPieces';
import { startCheckout, startTeamCheckout, isAuthed, getBillingConfig, getBillingAvailability, type BillingAvailability, type BillingItem } from '../services/billingService';
import { useSearchParams } from 'react-router-dom';
import CheckoutConsent from '../components/billing/CheckoutConsent';
import {
  PRICING_TIERS,
  CREDIT_PACKS,
  formatPrice,
  formatCredits,
  type PricingTier,
  type CreditPack,
} from '../config/pricing';

type LivePrice = { price: number; currency: string };
type BillingInterval = 'month' | 'year';

const planKey = (plan: string, interval: string = 'month') => `${plan}:${interval}`;

function billingNote(item: BillingItem, currency: string): string {
  const parts = item.interval === 'year'
    ? [`Billed annually at ${formatPrice(item.price, currency)}`]
    : ['Billed monthly'];
  if (item.perSeat) parts.push('per seat');
  parts.push('cancel any time');
  return `${parts.join(' · ')}.`;
}

function foundingPromise(item?: BillingItem, currency = 'eur'): string | undefined {
  if (!item?.founding || !item.becomes) return undefined;
  const then = item.becomes.perMonth ?? item.becomes.price;
  const unit = item.becomes.perMonth != null || item.interval !== 'year' ? '/mo' : '';
  return `${formatPrice(then, currency)}${unit} for everyone who joins later. You keep this price for as long as you stay.`;
}

/** The toggle changes every personal/team card, so its saving claim uses the
 * smallest exact saving in the live catalog. */
function annualSavingFrom(catalog: BillingItem[]): number | null {
  const savings = catalog
    .filter((item) => item.kind === 'subscription' && item.interval === 'year')
    .map((yearly) => {
      const monthly = catalog.find((item) =>
        item.kind === 'subscription' && item.plan === yearly.plan && (item.interval || 'month') === 'month');
      if (!monthly?.price || !yearly.price) return null;
      const yearOfMonths = monthly.price * 12;
      return ((yearOfMonths - yearly.price) * 100) / yearOfMonths;
    })
    .filter((saving): saving is number => typeof saving === 'number' && saving > 0);
  return savings.length ? Math.floor(Math.min(...savings)) : null;
}

/** Shared Stripe Checkout starter: signed-out users go to /auth first, signed-in users
 *  are redirected to Stripe. Reuses the existing billing flow — no new billing surface. */
function useCheckout() {
  const navigate = useNavigate();
  /* A download intent, if the visitor arrived here from a Download button. It
   * rides through Stripe on the session metadata so the WEBHOOK can attribute
   * the purchase — that is the only channel that survives the round trip. */
  const [params] = useSearchParams();
  const downloadIntent = params.get('i');
  const [busyId, setBusyId] = React.useState<string | null>(null);
  /* 🔴 Checkout REFUSES without a recorded consent (fail-closed, server side), so
   * the purchase is staged here until the buyer has actually given it. Jumping
   * straight to Stripe would 400 for every customer. */
  const [pending, setPending] = React.useState<{ itemId: string } | null>(null);
  /* 'unknown' until the config answers, and 'unknown' behaves exactly like
   * today — the button stays live and the server remains the authority. Only a
   * definite 'disabled' changes what the page says. */
  const [availability, setAvailability] = React.useState<BillingAvailability>('unknown');
  React.useEffect(() => {
    let on = true;
    getBillingAvailability().then((v) => { if (on) setAvailability(v); }).catch(() => {});
    return () => { on = false; };
  }, []);
  const start = React.useCallback(
    async (itemId: string) => {
      if (!isAuthed()) {
        /* 🔴 `returnUrl`, NOT `return`. AuthContent.tsx reads `returnUrl`; the
         * old `return` was silently ignored, so every signed-out visitor who
         * clicked a plan CTA authenticated and then never came back to pricing.
         * A dropped parameter on the one page that takes money. */
        const back = downloadIntent
          ? `/pricing?i=${encodeURIComponent(downloadIntent)}`
          : '/pricing';
        navigate(`/login?returnUrl=${encodeURIComponent(back)}`);
        return;
      }
      /* Stage it. The consent dialog calls back with a consent id. */
      setPending({ itemId });
      // On success the browser is redirected to Stripe Checkout.
    },
    [navigate, downloadIntent],
  );
  /* Called by the consent dialog once the buyer has agreed and it is recorded. */
  const proceed = React.useCallback(async (itemId: string, consentId: string) => {
    setPending(null);
    setBusyId(itemId);
    const r = itemId === 'team_seat' || itemId === 'team_annual'
      ? await startTeamCheckout(itemId, { consentId, downloadIntent: downloadIntent || undefined })
      : await startCheckout(itemId, downloadIntent || undefined, consentId);
    if (!r.ok) {
      setBusyId(null);
      toast.error(r.error || 'Could not start checkout');
    }
  }, [downloadIntent]);

  return { start, busyId, availability, downloadIntent, pending, setPending, proceed };
}

const ctaClass = (featured?: boolean) =>
  `mt-6 block rounded-[9px] px-4 py-2.5 text-center text-[13.5px] font-semibold transition-colors ${
    featured
      ? 'bg-white text-black hover:bg-white/90'
      : 'border border-white/[0.12] text-[#ece7df] hover:border-white/[0.22]'
  }`;

/** A plan's call-to-action: one-click Stripe Checkout for billing plans (Pro/Team),
 *  a plain link for Free (download) / Enterprise (contact). */
/* 🔴 A refused download sends people here. If checkout is off, the honest answer
 * is to say so — not to render a Buy button whose only outcome is a red toast
 * reading "Billing is not configured on this server", which blames our
 * infrastructure for a decision we made and leaves the visitor with nowhere to
 * go. The download gate refuses, points at /pricing, and /pricing has to be a
 * real destination or the whole loop is closed. */
const PlanCTA: React.FC<{ plan: PricingTier; checkout: ReturnType<typeof useCheckout> }> = ({ plan, checkout }) => {
  if (plan.itemId) {
    const busy = checkout.busyId === plan.itemId;
    if (checkout.availability === 'disabled') {
      return (
        <div className="mt-6">
          <div className="w-full cursor-not-allowed rounded-[8px] border border-white/[0.09] px-4 py-2.5 text-center text-[13px] font-semibold text-[#69635b]">
            Not yet purchasable
          </div>
          <p className="mt-2 text-[11px] leading-[1.5] text-[#69635b]">
            Plans aren't on sale yet. Create a free account and you'll be first to know when they open.
          </p>
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={() => checkout.start(plan.itemId!)}
        disabled={busy}
        className={`${ctaClass(plan.featured)} w-full disabled:opacity-60`}
      >
        {busy ? 'Redirecting…' : plan.cta}
      </button>
    );
  }
  return (
    <Link to={plan.href} className={ctaClass(plan.featured)}>
      {plan.cta}
    </Link>
  );
};

/** A single optional credit pack — understated, reuses the same Checkout flow. */
const CreditPackCard: React.FC<{
  pack: CreditPack;
  live?: LivePrice;
  checkout: ReturnType<typeof useCheckout>;
}> = ({ pack, live, checkout }) => {
  const busy = checkout.busyId === pack.id;
  const off = checkout.availability === 'disabled';
  const price = formatPrice(live ? live.price : pack.price, live ? live.currency : pack.currency);
  return (
    <div className="flex items-center justify-between gap-3 rounded-[12px] border border-white/[0.07] bg-[#0d0d0d] px-5 py-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[13.5px] font-semibold text-[#ece7df]">{pack.label}</span>
          {pack.badge && (
            <span className="rounded-full border border-white/25 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-[#ece7df]">
              {pack.badge}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[12px] text-[#948d83]">{formatCredits(pack.credits)}</div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[16px] font-semibold text-[#ece7df]">{price}</span>
        <button
          type="button"
          onClick={() => checkout.start(pack.id)}
          disabled={off || busy}
          title={off ? "Credit packs aren't on sale yet" : undefined}
          className="rounded-[8px] border border-white/[0.12] px-3 py-1.5 text-[12px] font-semibold text-[#ece7df] transition-colors hover:border-white/[0.22] disabled:opacity-60"
        >
          {off ? '—' : busy ? '…' : 'Buy'}
        </button>
      </div>
    </div>
  );
};

const Pricing: React.FC = () => {
  const checkout = useCheckout();
  const navigate = useNavigate();
  const [billingInterval, setBillingInterval] = React.useState<BillingInterval>('month');

  // Prefer the LIVE catalog price (which mirrors the Stripe Price actually charged) so the
  // advertised price always equals the charged price; fall back to the static value.
  const [live, setLive] = React.useState<Record<string, LivePrice>>({});
  const [offered, setOffered] = React.useState<Record<string, BillingItem>>({});
  const [catalog, setCatalog] = React.useState<BillingItem[]>([]);
  React.useEffect(() => {
    let on = true;
    getBillingConfig().then((cfg) => {
      if (!on) return;
      const prices: Record<string, LivePrice> = {};
      const plans: Record<string, BillingItem> = {};
      for (const item of cfg.catalog) {
        prices[item.id] = { price: item.price, currency: item.currency || cfg.currency };
        if (item.kind === 'subscription' && item.plan) plans[planKey(item.plan, item.interval)] = item;
      }
      setLive(prices);
      setOffered(plans);
      setCatalog(cfg.catalog);
    }).catch(() => {});
    return () => { on = false; };
  }, []);

  /* The server offers exactly one Everything generation (founding OR list).
   * Replace the static fallback id and amount with that offered item together,
   * so the button can never advertise one price and submit another SKU. */
  const displayPlans = PRICING_TIERS.map((plan) => {
    const interval = plan.id === 'studio' ? 'month' : billingInterval;
    const livePlan = plan.id === 'free' ? undefined : offered[planKey(plan.id, interval)];
    if (!livePlan) return plan;
    return {
      ...plan,
      itemId: livePlan.id,
      price: livePlan.perMonth ?? livePlan.price,
      currency: livePlan.currency,
      cadence: plan.id === 'team' ? '/seat/mo' : '/mo',
      note: billingNote(livePlan, livePlan.currency),
    } satisfies PricingTier;
  });

  const primaryPlans = displayPlans.filter((plan) => plan.id !== 'studio');
  const studioPlan = displayPlans.find((plan) => plan.id === 'studio')!;
  const displayedItems = Object.fromEntries(displayPlans.map((plan) => [
    plan.id,
    plan.itemId ? catalog.find((item) => item.id === plan.itemId) : undefined,
  ])) as Record<string, BillingItem | undefined>;
  const hasAnnual = catalog.some((item) => item.kind === 'subscription' && item.interval === 'year');
  const annualSaving = annualSavingFrom(catalog);

  const priceLabel = (plan: PricingTier): string => {
    if (plan.price === 'custom') return 'Custom';
    return formatPrice(plan.price, plan.currency);
  };

  const pendingPlan = checkout.pending
    ? displayPlans.find((plan) => plan.itemId === checkout.pending!.itemId)
    : undefined;
  const pendingItem = checkout.pending
    ? catalog.find((item) => item.id === checkout.pending!.itemId)
    : undefined;
  const consentPrice = pendingItem?.interval === 'year'
    ? `${formatPrice(pendingItem.price, pendingItem.currency)}/year (${formatPrice(pendingItem.perMonth ?? pendingItem.price, pendingItem.currency)}/month)`
    : priceLabel(pendingPlan || displayPlans[0]);

  return (
  <>
  {checkout.pending && (
    <CheckoutConsent
      itemId={checkout.pending.itemId}
      planLabel={pendingPlan?.name || 'XENO'}
      priceLabel={consentPrice}
      onCancel={() => checkout.setPending(null)}
      onConsented={(consentId) => void checkout.proceed(checkout.pending!.itemId, consentId)}
    />
  )}
  <MarketingPage
    eyebrow="PRICING"
    title="Choose how you run XENO."
    subtitle="A XENO account and web workspace are free. An active plan unlocks new desktop installers and the connected platform. Team adds collaboration per paid seat."
    updated="August 2026"
    contentMaxWidth={1240}
  >
    <Section className="mx-auto max-w-[1040px]">
      {hasAnnual && (
        <div className="mb-10 flex justify-center">
          <div
            role="group"
            aria-label="Billing interval"
            className="inline-flex gap-[2px] rounded-[9px] border border-white/[0.08] bg-[#08080a] p-1"
          >
            {([
              { id: 'month' as const, label: 'Monthly' },
              { id: 'year' as const, label: 'Yearly', hint: annualSaving ? `save ${annualSaving}%` : undefined },
            ]).map((option) => {
              const selected = billingInterval === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setBillingInterval(option.id)}
                  className={`rounded-[6px] px-4 py-2 text-[12.5px] font-medium transition-all duration-200 ${
                    selected ? 'bg-[#242424] text-white' : 'text-white/40 hover:text-white/70'
                  }`}
                >
                  {option.label}
                  {option.hint && (
                    <span className={`ml-2 text-[10.5px] ${selected ? 'text-white/45' : 'text-white/25'}`}>
                      {option.hint}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {primaryPlans.map((plan) => {
          const item = displayedItems[plan.id];
          const isFree = plan.id === 'free';
          const available = isFree || (checkout.availability !== 'disabled' && (item?.available ?? true));
          return (
            <PlanCard
              key={plan.id}
              label={plan.name}
              price={priceLabel(plan)}
              interval={isFree ? '' : 'month'}
              note={isFree ? 'No card, no expiry.' : (item ? billingNote(item, item.currency) : plan.note)}
              description={plan.line}
              promise={foundingPromise(item, item?.currency)}
              features={plan.features.slice(0, 6)}
              locked={isFree ? PRICING_TIERS.find((tier) => tier.id === 'pro')!.features.slice(0, 6) : []}
              highlighted={plan.featured}
              badge={plan.featured ? 'Most popular' : undefined}
              available={available}
              busy={Boolean(plan.itemId && checkout.busyId === plan.itemId)}
              ctaLabel={plan.cta}
              footerNote={isFree ? 'No card · No expiry' : undefined}
              onSelect={() => isFree ? navigate(plan.href) : checkout.start(plan.itemId!)}
            />
          );
        })}
      </div>

      <div className="mt-7 grid gap-[2px] rounded-[12px] border border-white/[0.08] bg-[#08080a] p-1.5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)]">
        <div className="rounded-[8px] bg-[#161616] px-6 py-5 sm:px-7">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">{studioPlan.name}</div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-[32px] font-semibold leading-none tracking-[-0.035em] text-white/85">{priceLabel(studioPlan)}</span>
                <span className="text-[12px] text-white/35">/month</span>
              </div>
            </div>
            <p className="max-w-[420px] text-[13px] leading-relaxed text-white/45">{studioPlan.line}</p>
          </div>
          <p className="mt-4 text-[11.5px] leading-relaxed text-white/30">{studioPlan.note}</p>
        </div>
        <div className="rounded-[8px] bg-[#111111] px-6 py-5">
          <div className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
            {studioPlan.features.map((feature) => (
              <div key={feature} className="flex items-start gap-2 text-[12.5px] leading-snug text-white/60">
                <span className="mt-[7px] h-1 w-1 shrink-0 bg-white/45" />
                {feature}
              </div>
            ))}
          </div>
          <PlanCTA plan={studioPlan} checkout={checkout} />
        </div>
      </div>
    </Section>

    <Section title="Account, software, and platform — where the line is">
      <p className="mb-5 text-[14px] leading-[1.75] text-[#9b948a]">
        There is no watermark or time-limited edition. A free account can use the web workspace, and an
        app already on your machine keeps working locally. An active plan is required to obtain a new
        desktop installer and to use the paid platform capabilities attached to it.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-[12px] border border-white/[0.07] bg-[#0d0d0d] p-6">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#69635b]">Free account</div>
          <h3 className="mt-2 text-[15px] font-semibold text-[#ece7df]">A real web workspace</h3>
          <p className="mt-2 text-[13px] leading-[1.65] text-[#948d83]">
            Browse products and release notes, use the web surfaces available to your account, and keep
            using desktop apps you already obtained. Free does not grant a new installer, commercial-use
            rights, cloud sync, agent identity access, or collaboration.
          </p>
        </div>
        <div className="rounded-[12px] border border-white/20 bg-[#0d0d0d] p-6">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#ece7df]">Everything &amp; Team</div>
          <h3 className="mt-2 text-[15px] font-semibold text-[#ece7df]">Wires the tools together</h3>
          <p className="mt-2 text-[13px] leading-[1.65] text-[#948d83]">
            One account unlocks the server-backed platform: cloud projects and sync, agent identities,
            and the cross-app layer as product integrations roll out. The commercial-use license covers
            your output. Team adds real-time collaboration and shared workspace billing on top.
          </p>
        </div>
      </div>
    </Section>

    <Section title="Optional: credit packs">
      <p className="mb-5 text-[14px] leading-[1.75] text-[#9b948a]">
        Credits are separate from your plan and entirely optional. They're à-la-carte fuel for
        managed-premium inference (frontier and third-party models) and the marketplace. They are never
        bundled into a subscription, and paid credits do not expire. BYOK is planned; local xeno-rt uses
        your own hardware when available and is not a hosted-credit charge.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {CREDIT_PACKS.map((pack) => (
          <CreditPackCard key={pack.id} pack={pack} live={live[pack.id]} checkout={checkout} />
        ))}
      </div>
    </Section>

    <Section title="Frequently asked questions">
      <Prose
        blocks={[
          {
            h: 'Is the free version a trial?',
            p: <>The account is not a trial. It has no card requirement or expiry. A new XENO desktop installer requires an active plan; software already obtained keeps working locally. Hosted in-house inference is not currently served, so it is not presented as an available Free feature.</>,
          },
          {
            h: 'What actually changes when I upgrade?',
            p: <>Everything grants the available desktop installers and paid platform entitlements: cloud sync, private cloud projects, agent identity access, managed-premium priority, commercial-use rights, and the cross-app layer as product integrations roll out. Team adds real-time collaboration and workspace billing per paid seat.</>,
          },
          {
            h: 'Do I need credits to use XENO?',
            p: <>No. A subscription unlocks software and platform capabilities. Credits are a separate optional top-up for managed-premium inference and marketplace purchases. BYOK is planned and not yet available; local xeno-rt runs on your own hardware when available.</>,
          },
          {
            h: 'Do credits expire?',
            p: <>Purchased credits never expire. They stay in your balance until you use them — or, on Team, in a shared pooled wallet.</>,
          },
          {
            h: 'Which AI models can I run?',
            /*
             * BYOK was removed from this answer on 2026-07-30 because it does not
             * exist anywhere in the estate. The platform's own inference router
             * returns { error: 'byok_unavailable' } for the byok path
             * (src/server/routes/aiRoutes.js:135 — its comment reads "Until the
             * XENO API exposes this, byok is unavailable"), and the XENO API
             * gateway on xeno-private-api-001 contains no BYOK code at all:
             * checked, zero matches.
             *
             * A pricing page is where someone decides whether to pay us, so every
             * capability named here has to be one they can actually use. Restore
             * this in the same commit that makes the byok path return something
             * other than an error — not before.
             */
            p: <>XENO aggregates the models you can already reach: open models that run in-house on xeno-rt, plus managed-premium routing that reaches frontier models for you and meters them in credits. Connecting your own provider key (BYOK) is planned and not yet available. We don't claim exclusive models or to replace any one provider.</>,
          },
          {
            h: 'Can I change plans?',
            p: <>Yes. Upgrade or downgrade at any time from your <Link to="/overview/billing" className="text-[#ece7df] hover:underline">account billing</Link> — changes take effect on your next cycle and your remaining credits stay intact. See the <Link to="/refunds" className="text-[#ece7df] hover:underline">refund policy</Link> for eligibility and timing.</>,
          },
        ]}
      />
    </Section>
  </MarketingPage>
  </>
  );
};

export default Pricing;

import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import MarketingPage, { Section, Prose, CheckList } from '../components/marketing/MarketingPage';
import { startCheckout, isAuthed, getLivePriceMap, getBillingAvailability, type BillingAvailability } from '../services/billingService';
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
    const r = await startCheckout(itemId, downloadIntent || undefined, consentId);
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

  // Prefer the LIVE catalog price (which mirrors the Stripe Price actually charged) so the
  // advertised price always equals the charged price; fall back to the static value.
  const [live, setLive] = React.useState<Record<string, LivePrice>>({});
  React.useEffect(() => {
    let on = true;
    getLivePriceMap().then((m) => { if (on) setLive(m); }).catch(() => {});
    return () => { on = false; };
  }, []);

  const priceLabel = (plan: PricingTier): string => {
    if (plan.price === 'custom') return 'Custom';
    const l = plan.itemId ? live[plan.itemId] : undefined;
    return formatPrice(l ? l.price : plan.price, l ? l.currency : plan.currency);
  };

  return (
  <>
  {checkout.pending && (
    <CheckoutConsent
      itemId={checkout.pending.itemId}
      planLabel={PRICING_TIERS.find((t) => t.itemId === checkout.pending!.itemId)?.name || 'XENO'}
      priceLabel={priceLabel(PRICING_TIERS.find((t) => t.itemId === checkout.pending!.itemId) || PRICING_TIERS[0])}
      onCancel={() => checkout.setPending(null)}
      onConsented={(consentId) => void checkout.proceed(checkout.pending!.itemId, consentId)}
    />
  )}
  <MarketingPage
    eyebrow="PRICING"
    title="One plan. Every app, and the platform they run on."
    subtitle="A XENO account is free and real — the in-house API, credits, and the whole platform surface. Installing the apps takes a plan, and one plan covers all of them plus what connects them: cloud sync, cross-app workflows, agents, and collaboration."
    updated="July 2026"
  >
    <Section>
      <div className="mb-6 rounded-[12px] border border-white/[0.09] bg-[#0d0d0d] px-5 py-4 text-[13px] leading-[1.6] text-[#b6afa5]">
        <span className="font-semibold text-[#ece7df]">A free account is real — but the apps need a plan.</span>{' '}
        Free gives you the account, the in-house API and credits to use it. Downloading and running the
        desktop apps requires a paid plan, and one plan covers every app plus the platform around them:
        sync, cross-app workflows, agents and collaboration. No per-app pricing, ever.
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PRICING_TIERS.map((plan) => (
          <div
            key={plan.name}
            className={`flex flex-col rounded-[14px] border bg-[#0d0d0d] p-6 ${
              plan.featured ? 'border-white/30' : 'border-white/[0.07]'
            }`}
          >
            {plan.featured && (
              <div className="mb-3 inline-flex w-fit rounded-full border border-white/25 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#ece7df]">
                Most popular
              </div>
            )}
            <h3 className="text-[15px] font-semibold text-[#ece7df]">{plan.name}</h3>
            <div className="mt-2 flex items-end gap-1">
              <span className="text-[28px] font-semibold leading-none tracking-[-0.02em] text-[#ece7df]">{priceLabel(plan)}</span>
              {plan.cadence && <span className="pb-1 text-[12.5px] text-[#69635b]">{plan.cadence}</span>}
            </div>
            <p className="mt-2 text-[12.5px] leading-[1.5] text-[#948d83]">{plan.line}</p>
            <div className="mt-5 flex-1">
              <CheckList items={plan.features} />
            </div>
            <PlanCTA plan={plan} checkout={checkout} />
            {plan.note && (
              <p className="mt-3 text-[11px] leading-[1.5] text-[#69635b]">{plan.note}</p>
            )}
          </div>
        ))}
      </div>
    </Section>

    <Section title="Tool vs platform — where the line actually is">
      <p className="mb-5 text-[14px] leading-[1.75] text-[#9b948a]">
        Nothing about an app is crippled or time-limited — there is no reduced edition and no watermark.
        The line is simply where it has always been for desktop software: a plan is what gets you the
        app, and the same plan is what connects the apps to each other.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-[12px] border border-white/[0.07] bg-[#0d0d0d] p-6">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#69635b]">The tool · Free</div>
          <h3 className="mt-2 text-[15px] font-semibold text-[#ece7df]">Runs on your machine</h3>
          <p className="mt-2 text-[13px] leading-[1.65] text-[#948d83]">
            Every app installs and runs locally — edit local files, export clean at full resolution, and
            drive inference with your own API key or in-house open models. No account required to create.
            It's an island: no cloud, no cross-app workflows, no agents, no collaboration.
          </p>
        </div>
        <div className="rounded-[12px] border border-white/20 bg-[#0d0d0d] p-6">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#ece7df]">The platform · Pro &amp; Team</div>
          <h3 className="mt-2 text-[15px] font-semibold text-[#ece7df]">Wires the tools together</h3>
          <p className="mt-2 text-[13px] leading-[1.65] text-[#948d83]">
            One account turns the tools into a server-backed platform: projects sync across every device,
            work flows between apps, agents handle the busywork, and the commercial-use license covers your
            output. Team adds real-time collaboration and shared workspace billing on top.
          </p>
        </div>
      </div>
    </Section>

    <Section title="Optional: credit packs">
      <p className="mb-5 text-[14px] leading-[1.75] text-[#9b948a]">
        Credits are separate from your plan and entirely optional. They're à-la-carte fuel for
        managed-premium inference (frontier and third-party models) and the marketplace — never required
        for bring-your-own-key or in-house open models, and never bundled into a subscription. Paid
        credits don't expire.
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
            p: <>The account is. The apps are not — installing any XENO desktop app needs an active plan. What you get for free is a real account rather than a trial: the in-house API, credits, the Forum and the whole web platform, with no card and no expiry. What a plan buys is the software itself, and one plan covers every app rather than one per product.</>,
          },
          {
            h: 'What actually changes when I upgrade?',
            p: <>A plan gets you the desktop apps themselves, and everything that connects them: cloud sync and multi-device, workflows that span apps, agents and automation, private cloud projects, managed-premium inference priority, and the commercial-use license. Team adds real-time collaboration and shared workspace billing. A free account keeps the web platform, the in-house API and credits — it just does not install software.</>,
          },
          {
            h: 'Do I need credits to use XENO?',
            p: <>No. Your subscription unlocks features; credits are a separate, optional top-up. Credits fuel only managed-premium (frontier and third-party) inference and the marketplace — bring-your-own-key and in-house xeno-rt open models never cost credits.</>,
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

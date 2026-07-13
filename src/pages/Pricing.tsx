import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import MarketingPage, { Section, Prose, CheckList } from '../components/marketing/MarketingPage';
import { startCheckout, isAuthed, getLivePriceMap } from '../services/billingService';
import { PRICING_TIERS, formatPrice, type PricingTier } from '../config/pricing';

const ctaClass = (featured?: boolean) =>
  `mt-6 block rounded-[9px] px-4 py-2.5 text-center text-[13.5px] font-semibold transition-colors ${
    featured
      ? 'bg-white text-black hover:bg-white/90'
      : 'border border-white/[0.12] text-[#ece7df] hover:border-white/[0.22]'
  }`;

/** A plan's call-to-action: one-click Stripe Checkout for billing plans (Pro/Team),
 *  a plain link for Free / Enterprise. Sends signed-out users to /auth first. */
const PlanCTA: React.FC<{ plan: PricingTier }> = ({ plan }) => {
  const navigate = useNavigate();
  const [busy, setBusy] = React.useState(false);

  if (plan.itemId) {
    const onClick = async () => {
      if (!isAuthed()) {
        navigate(`/auth?return=${encodeURIComponent('/pricing')}`);
        return;
      }
      setBusy(true);
      const r = await startCheckout(plan.itemId!);
      if (!r.ok) {
        setBusy(false);
        toast.error(r.error || 'Could not start checkout');
      }
      // On success the browser is redirected to Stripe Checkout.
    };
    return (
      <button
        type="button"
        onClick={onClick}
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

const Pricing: React.FC = () => {
  // Prefer the LIVE catalog price (which mirrors the Stripe Price actually charged) so the
  // advertised price always equals the charged price; fall back to the static tier price.
  const [live, setLive] = React.useState<Record<string, { price: number; currency: string }>>({});
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
  <MarketingPage
    eyebrow="PRICING"
    title="One subscription. The whole suite."
    subtitle="Every XENO app — Pixel, Motion, Sound, Canvas and more — on one plan, powered by one shared credit balance. No per-tool subscriptions, no surprises."
    updated="July 2026"
  >
    <Section>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PRICING_TIERS.map((plan) => (
          <div
            key={plan.name}
            className={`flex flex-col rounded-[14px] border bg-[#0d0d0d] p-6 ${
              plan.featured ? 'border-[#a760ff]/40' : 'border-white/[0.07]'
            }`}
          >
            {plan.featured && (
              <div className="mb-3 inline-flex w-fit rounded-full border border-[#a760ff]/40 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#a760ff]">
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
            <PlanCTA plan={plan} />
          </div>
        ))}
      </div>
    </Section>

    <Section title="How credits work">
      <Prose
        blocks={[
          {
            p: (
              <>
                Credits are the single currency of XENO. Every AI action — generating an image,
                rendering a video, upscaling a frame, transcribing audio, running an agent — costs a
                small, predictable number of credits based on the work it does. Editing, designing,
                and saving your projects is always free; you only spend credits when you ask the AI
                to do something.
              </>
            ),
          },
          {
            p: (
              <>
                Your plan grants credits every month, and they apply across every app from one shared
                balance. Need more for a big push? Top up anytime. Unused context and project work
                carry over with you — pick up exactly where you left off, on any machine, through the
                Hub.
              </>
            ),
          },
        ]}
      />
    </Section>

    <Section title="Frequently asked questions">
      <Prose
        blocks={[
          {
            h: 'What is a credit?',
            p: <>A credit is the unit you spend to run an AI action. One credit covers a typical generation or edit; heavier work like long video renders uses proportionally more.</>,
          },
          {
            h: 'Can I change plans?',
            p: <>Yes. Upgrade or downgrade at any time from your account settings — changes take effect on your next cycle and your remaining credits stay intact.</>,
          },
          {
            h: 'Do you offer refunds?',
            p: <>We do, within the terms of our policy. See the <Link to="/refunds" className="text-[#a760ff] hover:underline">refund policy</Link> for full details on eligibility and timing.</>,
          },
          {
            h: 'Do credits expire?',
            p: <>Monthly plan credits refresh each cycle and don't stack indefinitely, while purchased top-up credits stay valid for an extended window. Your current balance and expiry are always visible in your account.</>,
          },
        ]}
      />
    </Section>
  </MarketingPage>
  );
};

export default Pricing;

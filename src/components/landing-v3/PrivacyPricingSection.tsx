import React from 'react';
import { Link } from 'react-router-dom';
import { Check, Cloud, Laptop, ShieldCheck, UserCog, ArrowRight } from 'lucide-react';
import { Eyebrow, Reveal, SectionHeading, cx } from './primitives';
import { PRICING_TIERS, formatPrice } from '../../config/pricing';

const privacyFeatures = [
  { icon: ShieldCheck, title: 'Never trained on your work', sub: 'Your data stays yours. Always.' },
  { icon: Laptop, title: 'Local-first', sub: 'Work offline at full performance.' },
  { icon: Cloud, title: 'Cloud or local models', sub: 'Choose the environment that fits.' },
  { icon: UserCog, title: 'Permission-based agents', sub: 'You control every access and action.' },
];

interface Plan {
  name: string;
  price: React.ReactNode;
  unit: string;
  tagline: string;
  perks: string[];
  cta: string;
  href: string;
  highlight?: boolean;
}

// The three self-serve tiers, sourced from the single canonical pricing module
// (src/config/pricing.ts → mirrors the server catalog → mirrors Stripe). Enterprise
// lives on the full /pricing page. No hardcoded prices; no "pay-as-you-grow" (the
// LOCKED model sells the subscription, not metered credits).
const UNIT_FOR: Record<string, string> = {
  free: 'free — the whole suite',
  pro: 'per creator · monthly',
  team: 'per seat · monthly',
};
const plans: Plan[] = PRICING_TIERS.filter((t) => t.id !== 'enterprise').map((t) => ({
  name: t.name,
  price: formatPrice(t.price, t.currency),
  unit: UNIT_FOR[t.id] || 'monthly',
  tagline: t.line,
  perks: t.features.slice(0, 5),
  cta: t.cta,
  href: t.href,
  highlight: t.featured,
}));

const PrivacyPricingSection: React.FC = () => {
  return (
    <section className="page-gutter border-t border-white/[0.06] bg-[#060606] py-[clamp(80px,11vh,150px)]">
      {/* ── Privacy card ─────────────────────────────────────────── */}
      <Reveal>
        <div className="relative mx-auto overflow-hidden rounded-[20px] border border-white/[0.05] bg-[#101010] px-[clamp(24px,2.6vw,56px)] py-[clamp(32px,4.4vh,60px)]">
          <div className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-[4px] bg-[radial-gradient(circle,rgba(167,96,255,0.20),transparent_70%)]" />
          <div className="relative grid grid-cols-1 gap-[clamp(28px,3vw,56px)] lg:grid-cols-[minmax(260px,34%)_1fr]">
            <div>
              <Eyebrow>Private by default</Eyebrow>
              <h2 className="mt-[clamp(14px,1.8vh,22px)] text-[clamp(1.6rem,2.1vw,2.6rem)] font-semibold leading-[1.12] tracking-[-0.01em] text-[#ece7df]">
                Powerful anywhere.<br />Your work stays yours.
              </h2>
              <p className="mt-[clamp(12px,1.6vh,20px)] max-w-[380px] text-[clamp(13px,0.95vw,15px)] leading-[1.6] text-[#948d83]">
                Run XENO on your machine or in the cloud. Your data is encrypted, never sold, and never used to train models.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-[clamp(16px,1.6vw,28px)] sm:grid-cols-2">
              {privacyFeatures.map((f, i) => (
                <Reveal key={f.title} delay={i * 70} className="flex gap-3.5">
                  <div className="grid h-[clamp(38px,3vw,46px)] w-[clamp(38px,3vw,46px)] shrink-0 place-items-center rounded-[10px] bg-[#1a1029]/45 text-[#c2aef0]">
                    <f.icon className="h-[44%] w-[44%]" strokeWidth={1.6} />
                  </div>
                  <div>
                    <div className="text-[clamp(13.5px,0.98vw,16px)] font-semibold leading-tight text-[#e3ded5]">{f.title}</div>
                    <div className="mt-1.5 text-[clamp(11.5px,0.8vw,13px)] leading-[1.45] text-[#8a847b]">{f.sub}</div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </Reveal>

      {/* ── Pricing ──────────────────────────────────────────────── */}
      <div className="mt-[clamp(48px,6vh,88px)]">
        <SectionHeading
          eyebrow="Pricing"
          title="One subscription. The whole suite."
          sub="Every app on one plan, powered by one shared credit balance. Start free, upgrade when you're ready — no lock-in, no surprises."
        />

        <div className="mx-auto mt-[clamp(40px,6vh,72px)] grid max-w-[1040px] grid-cols-1 items-stretch gap-[clamp(16px,1.2vw,24px)] md:grid-cols-3">
          {plans.map((plan, i) => (
            <Reveal
              key={plan.name}
              delay={i * 80}
              className={cx(
                'relative flex flex-col rounded-[18px] border p-[clamp(22px,1.8vw,34px)] transition-colors',
                plan.highlight
                  ? 'border-[#9f6fff]/45 bg-[#14101f] shadow-[0_30px_80px_-32px_rgba(167,96,255,0.55)]'
                  : 'border-white/[0.05] bg-[#151515] hover:border-white/[0.12]',
              )}
            >
              {plan.highlight && (
                <span className="absolute right-5 top-5 rounded-[4px] border border-[#9f6fff]/40 bg-[#1a1029] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#bf85ff]">
                  Most popular
                </span>
              )}
              <div className="text-[clamp(13.5px,1vw,16px)] font-semibold text-[#d8d2ca]">{plan.name}</div>
              <div className="mt-[clamp(16px,2vh,28px)] flex items-baseline gap-2">
                <span className="text-[clamp(2.2rem,3vw,3.4rem)] font-light leading-none tracking-tight text-[#ece7df]">{plan.price}</span>
              </div>
              <div className="mt-2 text-[clamp(11.5px,0.85vw,13.5px)] text-[#8a847b]">{plan.unit}</div>
              <p className="mt-[clamp(12px,1.6vh,18px)] text-[clamp(12px,0.85vw,14px)] leading-[1.5] text-[#948d83]">{plan.tagline}</p>

              <ul className="mt-[clamp(18px,2.4vh,28px)] flex flex-col gap-[clamp(9px,1.2vh,14px)]">
                {plan.perks.map((perk) => (
                  <li key={perk} className="flex items-start gap-2.5 text-[clamp(12px,0.86vw,14px)] leading-snug text-[#c2bbb2]">
                    <span className={cx('mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[4px]', plan.highlight ? 'bg-[#a760ff]/20 text-[#bf85ff]' : 'bg-white/[0.06] text-[#b6afa5]')}>
                      <Check className="h-2.5 w-2.5" strokeWidth={2.4} />
                    </span>
                    {perk}
                  </li>
                ))}
              </ul>

              <a
                href={plan.href}
                className={cx(
                  'group mt-auto inline-flex h-[clamp(42px,4.4vh,52px)] w-full items-center justify-center gap-2 rounded-[9px] text-[clamp(12.5px,0.9vw,14.5px)] font-semibold transition-colors',
                  plan.highlight
                    ? 'bg-white text-black hover:bg-white/90'
                    : 'border border-white/[0.12] bg-white/[0.02] text-[#e3ded5] hover:border-white/25 hover:bg-white/[0.05]',
                )}
                style={{ marginTop: 'clamp(22px,3vh,34px)' }}
              >
                {plan.cta}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </a>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-[clamp(20px,3vh,32px)] text-center">
          <Link to="/pricing" className="group inline-flex items-center gap-1.5 text-[clamp(12.5px,0.9vw,14px)] font-medium text-[#948d83] transition-colors hover:text-[#e3ded5]">
            Compare all plans, including Enterprise
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </Reveal>
      </div>
    </section>
  );
};

export default PrivacyPricingSection;

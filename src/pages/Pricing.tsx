import React from 'react';
import { Link } from 'react-router-dom';
import MarketingPage, { Section, Prose, CheckList } from '../components/marketing/MarketingPage';

type Plan = {
  name: string;
  price: string;
  cadence?: string;
  line: string;
  features: string[];
  href: string;
  cta: string;
  featured?: boolean;
};

const plans: Plan[] = [
  {
    name: 'Free',
    price: '$0',
    line: 'Everything you need to start creating.',
    features: [
      'Monthly starter credit grant',
      'Access to image, video & audio generation',
      'XENO Hub + the creative apps',
      'Community support',
    ],
    href: '/auth',
    cta: 'Start free',
  },
  {
    name: 'Pro',
    price: '$20',
    cadence: '/mo',
    line: 'For creators who ship every day.',
    features: [
      'Generous monthly credit allotment',
      'All apps: Pixel, Motion, Sound, Canvas',
      'Priority generation queue',
      'Full Marketplace access',
      'Higher resolution & longer outputs',
      'Email support',
    ],
    href: '/auth',
    cta: 'Go Pro',
    featured: true,
  },
  {
    name: 'Team',
    price: '$60',
    cadence: '/user/mo',
    line: 'For teams creating together.',
    features: [
      'Shared workspace & credit pool',
      'Real-time multiplayer in Canvas',
      'Admin roles & usage controls',
      'Centralized billing',
      'Shared asset & component libraries',
      'Priority support',
    ],
    href: '/auth',
    cta: 'Start a team',
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    line: 'For organizations at scale.',
    features: [
      'SSO & SCIM provisioning',
      'Dedicated capacity & private models',
      'SLA & uptime guarantees',
      'Security review & DPA',
      'Dedicated success manager',
    ],
    href: '/contact',
    cta: 'Contact sales',
  },
];

const Pricing: React.FC = () => (
  <MarketingPage
    eyebrow="PRICING"
    title="Simple, credit-based pricing"
    subtitle="Pick a plan, get credits, and spend them on any AI action across every XENO app. No per-tool subscriptions, no surprises — one balance powers the whole ecosystem."
    updated="June 2026"
  >
    <Section>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => (
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
              <span className="text-[28px] font-semibold leading-none tracking-[-0.02em] text-[#ece7df]">{plan.price}</span>
              {plan.cadence && <span className="pb-1 text-[12.5px] text-[#69635b]">{plan.cadence}</span>}
            </div>
            <p className="mt-2 text-[12.5px] leading-[1.5] text-[#948d83]">{plan.line}</p>
            <div className="mt-5 flex-1">
              <CheckList items={plan.features} />
            </div>
            <Link
              to={plan.href}
              className={`mt-6 rounded-[9px] px-4 py-2.5 text-center text-[13.5px] font-semibold transition-colors ${
                plan.featured
                  ? 'bg-white text-black hover:bg-white/90'
                  : 'border border-white/[0.12] text-[#ece7df] hover:border-white/[0.22]'
              }`}
            >
              {plan.cta}
            </Link>
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
            p: <>Yes. Upgrade, downgrade, or switch between monthly and annual at any time from your account settings — changes take effect on your next cycle and your remaining credits stay intact.</>,
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

export default Pricing;

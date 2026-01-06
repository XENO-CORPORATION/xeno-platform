import React, { useState } from 'react';
import { Check, Sparkles, Building2, ArrowRight } from 'lucide-react';

interface PricingSectionProps {
  onGetStarted: () => void;
}

const PricingSection: React.FC<PricingSectionProps> = ({ onGetStarted }) => {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('yearly');

  const plans = [
    {
      name: 'Starter',
      description: 'Perfect for exploring AI creativity',
      price: { monthly: 0, yearly: 0 },
      features: [
        '50 generations per month',
        'Basic AI models',
        '720p output resolution',
        'Community support',
        '5 saved projects',
      ],
      cta: 'Get Started',
      popular: false,
    },
    {
      name: 'Pro',
      description: 'For serious creators and professionals',
      price: { monthly: 29, yearly: 19 },
      features: [
        'Unlimited generations',
        'All premium AI models',
        '4K output resolution',
        'Priority support',
        'Unlimited projects',
        'Custom workflows',
        'API access',
        'Team collaboration',
      ],
      cta: 'Start Free Trial',
      popular: true,
    },
    {
      name: 'Enterprise',
      description: 'Custom solutions for large teams',
      price: { monthly: null, yearly: null },
      features: [
        'Everything in Pro',
        'Dedicated infrastructure',
        'Custom model training',
        'SLA guarantee',
        'Dedicated account manager',
        'Security & compliance',
        'On-premise deployment',
        'Custom integrations',
      ],
      cta: 'Contact Sales',
      popular: false,
    },
  ];

  return (
    <section className="relative py-28 px-6 lg:px-8 bg-[#08080a]">
      <div className="max-w-[1200px] mx-auto">
        {/* Header */}
        <div className="text-center mb-14">
          <p className="text-[13px] text-white/40 uppercase tracking-[0.15em] font-medium mb-4">
            Pricing
          </p>
          <h2 className="text-[clamp(2rem,5vw,3.25rem)] font-semibold text-white tracking-[-0.02em] leading-[1.15] mb-5">
            Start free. Scale when ready.
          </h2>
          <p className="text-[17px] text-white/40 leading-[1.7] max-w-lg mx-auto mb-10">
            No hidden fees. No surprises. Just straightforward pricing that grows with you.
          </p>
          
          {/* Billing toggle */}
          <div className="inline-flex items-center gap-1 p-1 bg-white/[0.03] rounded-xl border border-white/[0.06]">
            <button
              onClick={() => setBillingCycle('monthly')}
              className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                billingCycle === 'monthly' 
                  ? 'bg-white text-black' 
                  : 'text-white/60 hover:text-white'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingCycle('yearly')}
              className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                billingCycle === 'yearly' 
                  ? 'bg-white text-black' 
                  : 'text-white/60 hover:text-white'
              }`}
            >
              Yearly
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                billingCycle === 'yearly' 
                  ? 'bg-black/10 text-black/70' 
                  : 'bg-green-500/20 text-green-400'
              }`}>
                Save 35%
              </span>
            </button>
          </div>
        </div>

        {/* Pricing cards */}
        <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
          {plans.map((plan, index) => (
            <div
              key={plan.name}
              className={`relative rounded-2xl p-8 transition-all duration-300 ${
                plan.popular 
                  ? 'bg-white/[0.04] border-2 border-white/[0.1] scale-[1.02] lg:scale-105' 
                  : 'bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.08]'
              }`}
            >
              {/* Popular badge */}
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <div className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-white text-black text-sm font-medium rounded-full">
                    <Sparkles size={14} />
                    Most Popular
                  </div>
                </div>
              )}

              {/* Plan header */}
              <div className="mb-8">
                <h3 className="text-xl font-semibold text-white mb-2">{plan.name}</h3>
                <p className="text-sm text-white/50">{plan.description}</p>
              </div>

              {/* Price */}
              <div className="mb-8">
                {plan.price.monthly !== null ? (
                  <div className="flex items-baseline gap-1">
                    <span className="text-5xl font-bold text-white tracking-tight">
                      ${billingCycle === 'monthly' ? plan.price.monthly : plan.price.yearly}
                    </span>
                    <span className="text-white/40">/month</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Building2 size={24} className="text-white/60" />
                    <span className="text-2xl font-semibold text-white">Custom</span>
                  </div>
                )}
                {billingCycle === 'yearly' && plan.price.yearly !== null && plan.price.monthly !== null && (
                  <p className="text-sm text-white/40 mt-2">
                    Billed annually (${plan.price.yearly * 12}/year)
                  </p>
                )}
              </div>

              {/* Features */}
              <ul className="space-y-3 mb-8">
                {plan.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-white/[0.06] flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Check size={12} className="text-white/70" />
                    </div>
                    <span className="text-sm text-white/60">{feature}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <button
                onClick={onGetStarted}
                className={`w-full py-3.5 rounded-xl font-medium transition-all flex items-center justify-center gap-2 ${
                  plan.popular 
                    ? 'bg-white text-black hover:bg-white/90' 
                    : 'bg-white/[0.05] text-white border border-white/[0.1] hover:bg-white/[0.08]'
                }`}
              >
                {plan.cta}
                <ArrowRight size={16} />
              </button>
            </div>
          ))}
        </div>

        {/* FAQ link */}
        <div className="text-center mt-16">
          <p className="text-white/40">
            Questions? Check our{' '}
            <button className="text-white underline underline-offset-4 hover:text-white/80 transition-colors">
              FAQ
            </button>
            {' '}or{' '}
            <button className="text-white underline underline-offset-4 hover:text-white/80 transition-colors">
              contact support
            </button>
          </p>
        </div>
      </div>
    </section>
  );
};

export default PricingSection;

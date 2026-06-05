import React from 'react';
import { ArrowRight, Check, Cloud, Laptop, Shield, ShieldCheck, UserCog } from 'lucide-react';

const privacyFeatures = [
  {
    icon: ShieldCheck,
    title: 'We never train on your work',
    sub: 'Your data stays yours. Always.',
  },
  {
    icon: Laptop,
    title: 'Local-first',
    sub: 'Work offline with full performance.',
  },
  {
    icon: Cloud,
    title: 'Cloud or local models',
    sub: 'Choose the environment that fits you.',
  },
  {
    icon: UserCog,
    title: 'Permission-based agents',
    sub: 'You control access and actions.',
  },
];

const planPerks = [
  'Access to XENO workspace',
  'All core AI models',
  'Image, video, audio, 3D tools',
  'Visual workflows',
  'Local-first projects',
  'Community & support',
];

const PrivacyPricingSection: React.FC = () => {
  return (
    <section className="bg-[#060606] px-[1vw] pb-[clamp(64px,9vh,120px)] pt-[clamp(40px,5vh,72px)]">
      <div className="mx-auto flex w-full flex-col gap-[1vw]">
        {/* ──────────────────────────────────────────────────────────
         * PRIVACY CARD — floating rounded container
         * ────────────────────────────────────────────────────────── */}
        <div className="rounded-[16px] border border-white/[0.08] bg-[#151515] px-[clamp(24px,2.4vw,52px)] py-[clamp(28px,3.6vh,52px)]">
          <div className="grid grid-cols-1 gap-[clamp(28px,3vw,52px)] lg:grid-cols-[minmax(260px,28%)_1fr]">
            <div>
              <span className="text-[clamp(10.5px,0.75vw,12px)] font-semibold uppercase tracking-[0.22em] text-[#756f66]">
                Private by default
              </span>
              <h2 className="mt-[clamp(10px,1.4vh,20px)] text-[clamp(1.6rem,2vw,2.4rem)] font-light leading-[1.2] tracking-tight text-white">
                Powerful anywhere.<br />Your work stays yours.
              </h2>
            </div>

            <div className="grid grid-cols-2 gap-[clamp(20px,1.8vw,36px)] lg:grid-cols-4">
              {privacyFeatures.map((f) => (
                <div key={f.title} className="flex flex-col gap-[clamp(10px,1.2vh,18px)]">
                  <div className="grid h-[clamp(36px,3vw,44px)] w-[clamp(36px,3vw,44px)] place-items-center rounded-full border border-white/[0.18] text-[#d8d2ca]">
                    <f.icon className="h-[44%] w-[44%]" strokeWidth={1.5} />
                  </div>
                  <div>
                    <div className="text-[clamp(13px,0.95vw,15.5px)] font-medium leading-[1.25] text-white">
                      {f.title}
                    </div>
                    <div className="mt-1.5 max-w-[200px] text-[clamp(11px,0.78vw,12.5px)] leading-[1.45] text-[#8a847b]">
                      {f.sub}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ──────────────────────────────────────────────────────────
         * PRICING — title left | plan cards | feature checklist right
         * ────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-[clamp(28px,3vw,52px)] py-[clamp(32px,4vh,64px)] lg:grid-cols-[minmax(220px,22%)_1fr_minmax(220px,22%)]">
          {/* Left: title */}
          <div className="flex flex-col">
            <span className="text-[clamp(10.5px,0.75vw,12px)] font-semibold uppercase tracking-[0.22em] text-[#756f66]">
              Start free
            </span>
            <h2 className="mt-[clamp(10px,1.4vh,20px)] text-[clamp(1.6rem,2vw,2.4rem)] font-light leading-[1.2] tracking-tight text-white">
              Scale when you<br />need more.
            </h2>
            <p className="mt-[clamp(12px,1.4vh,20px)] text-[clamp(12px,0.85vw,14px)] leading-[1.5] text-[#948d83]">
              Simple, transparent pricing.
            </p>
          </div>

          {/* Middle: 2 plan cards */}
          <div className="grid grid-cols-1 gap-[1vw] sm:grid-cols-2">
            {/* Free plan */}
            <div className="flex flex-col rounded-[16px] border border-white/[0.08] bg-[#151515] p-[clamp(20px,1.8vw,32px)]">
              <div className="text-[clamp(13.5px,1vw,16px)] font-medium text-[#d8d2ca]">Free Plan</div>
              <div className="mt-[clamp(16px,2vh,28px)] flex items-baseline gap-2.5">
                <span className="text-[clamp(2.4rem,3.2vw,4rem)] font-light leading-none tracking-tight text-white">
                  1000
                </span>
                <span className="text-[clamp(11.5px,0.85vw,13.5px)] text-[#8a847b]">free credits / month</span>
              </div>
              <p className="mt-[clamp(10px,1.4vh,18px)] text-[clamp(12px,0.85vw,14px)] text-[#948d83]">
                Perfect to explore and create.
              </p>
              <a
                href="/auth"
                className="mt-auto inline-flex h-[clamp(40px,4.4vh,52px)] w-full items-center justify-center rounded-[8px] border border-white/15 bg-white/[0.02] text-[clamp(12.5px,0.9vw,14.5px)] font-medium text-white transition-colors hover:border-white/30 hover:bg-white/[0.04]"
              >
                Get Started Free
              </a>
            </div>

            {/* Pay as you grow */}
            <div className="flex flex-col rounded-[16px] border border-white/[0.08] bg-[#151515] p-[clamp(20px,1.8vw,32px)]">
              <div className="text-[clamp(13.5px,1vw,16px)] font-medium text-[#d8d2ca]">Pay As You Grow</div>
              <div className="mt-[clamp(16px,2vh,28px)] flex items-baseline gap-2.5">
                <span className="text-[clamp(2.4rem,3.2vw,4rem)] font-light leading-none tracking-tight text-white">
                  $1
                </span>
                <span className="text-[clamp(2.4rem,3.2vw,4rem)] font-light leading-none tracking-tight text-[#948d83]">
                  =
                </span>
                <span className="text-[clamp(2.4rem,3.2vw,4rem)] font-light leading-none tracking-tight text-white">
                  1000
                </span>
                <span className="text-[clamp(11.5px,0.85vw,13.5px)] text-[#8a847b]">credits</span>
              </div>
              <p className="mt-[clamp(10px,1.4vh,18px)] text-[clamp(12px,0.85vw,14px)] text-[#948d83]">
                No subscription. Pay for what you use.
              </p>
              <a
                href="#pricing"
                className="mt-auto inline-flex h-[clamp(40px,4.4vh,52px)] w-full items-center justify-center rounded-[8px] border border-white/15 bg-transparent text-[clamp(12.5px,0.9vw,14.5px)] font-medium text-[#d8d2ca] transition-colors hover:border-white/30 hover:bg-white/[0.03]"
              >
                View pricing details
              </a>
            </div>
          </div>

          {/* Right: feature checklist */}
          <ul className="flex flex-col gap-[clamp(10px,1.4vh,18px)]">
            {planPerks.map((perk) => (
              <li key={perk} className="flex items-center gap-3 text-[clamp(12.5px,0.9vw,14.5px)] text-[#c2bbb2]">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-white/20 text-[#b6afa5]">
                  <Check className="h-3 w-3" strokeWidth={2.2} />
                </span>
                {perk}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
};

export default PrivacyPricingSection;

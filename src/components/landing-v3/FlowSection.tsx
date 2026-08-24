import React from 'react';
import { Layers, Sparkles, SlidersVertical, Workflow, Upload } from 'lucide-react';
import { Reveal, SectionHeading, cx } from './primitives';

const steps = [
  { label: 'Prompt',   sub: 'Describe your idea in plain language',  icon: Layers },
  { label: 'Generate', sub: 'AI explores possibilities in seconds',  icon: Sparkles },
  { label: 'Edit',     sub: 'Refine and perfect with precision',     icon: SlidersVertical },
  { label: 'Automate', sub: 'Agents run the repeatable work',        icon: Workflow },
  { label: 'Publish',  sub: 'Ship to any channel or format',         icon: Upload },
];

const FlowSection: React.FC = () => {
  return (
    <section className="page-gutter relative border-t border-white/[0.06] bg-[#060606] py-[clamp(80px,11vh,150px)]">
      <SectionHeading
        eyebrow="From idea to production"
        title={<>One flow.<br className="sm:hidden" /> Infinite possibilities.</>}
        sub="Generate, refine, automate and ship — without ever leaving XENO. Every stage hands off to the next, and an agent can run the entire pipeline for you."
      />

      <div className="mx-auto mt-[clamp(48px,7vh,96px)]">
        <ol className="flex flex-col items-stretch gap-y-9 md:flex-row md:items-stretch md:justify-between md:gap-y-0">
          {steps.map((step, i) => (
            <React.Fragment key={step.label}>
              <Reveal as="li" delay={i * 90} className="flex flex-1 flex-col items-center text-center md:px-2">
                <div className="relative grid h-[clamp(52px,4vw,70px)] w-[clamp(52px,4vw,70px)] place-items-center rounded-[16px] border border-white/[0.12] bg-[#151515] text-[#d8d2ca] transition-colors duration-300 hover:border-white/40">
                  <step.icon className="h-[42%] w-[42%]" strokeWidth={1.4} />
                  <span className="absolute -right-2 -top-2 grid h-[22px] w-[22px] place-items-center rounded-[4px] border border-white/40 bg-[#1a1029] text-[9.5px] font-bold tabular-nums text-white">
                    {i + 1}
                  </span>
                </div>
                <div className="mt-[clamp(14px,1.6vh,22px)] text-[clamp(14px,1.05vw,18px)] font-semibold text-white">{step.label}</div>
                <div className="mt-1.5 max-w-[170px] text-[clamp(11px,0.78vw,13px)] leading-[1.45] text-[#807970]">{step.sub}</div>
              </Reveal>

              {i < steps.length - 1 && (
                <li aria-hidden="true" className="hidden flex-1 self-start md:block" style={{ marginTop: 'clamp(25px,2vw,34px)' }}>
                  <div className={cx('xeno-flow-line w-full')} />
                </li>
              )}
            </React.Fragment>
          ))}
        </ol>
      </div>
    </section>
  );
};

export default FlowSection;

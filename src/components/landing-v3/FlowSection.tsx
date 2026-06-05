import React from 'react';
import { Layers, Sparkles, SlidersVertical, Workflow, Upload } from 'lucide-react';

const steps = [
  { label: 'Prompt',   sub: 'Describe your idea',          icon: Layers },
  { label: 'Generate', sub: 'AI creates possibilities',    icon: Sparkles },
  { label: 'Edit',     sub: 'Refine and perfect',          icon: SlidersVertical },
  { label: 'Automate', sub: 'Build intelligent workflows', icon: Workflow },
  { label: 'Publish',  sub: 'Deliver anywhere',            icon: Upload },
];

const FlowSection: React.FC = () => {
  return (
    <section className="border-t border-white/[0.06] bg-[#060606] px-[1vw] py-[clamp(56px,8vh,100px)]">
      <div className="mx-auto grid w-full grid-cols-1 items-center gap-[clamp(40px,5vw,72px)] lg:grid-cols-[minmax(260px,26%)_1fr]">
        {/* ── Left: title block ───────────────────────────── */}
        <div className="flex flex-col">
          <span className="text-[clamp(10.5px,0.75vw,12px)] font-semibold uppercase tracking-[0.22em] text-[#756f66]">
            From idea to production
          </span>
          <h2 className="mt-[clamp(10px,1.4vh,20px)] text-[clamp(1.8rem,2.2vw,2.8rem)] font-light leading-[1.15] tracking-tight text-white">
            One flow.<br />Infinite possibilities.
          </h2>
        </div>

        {/* ── Right: 5 steps connected by dotted lines ───── */}
        <div className="flex items-start justify-between gap-2">
          {steps.map((step, i) => (
            <React.Fragment key={step.label}>
              <div className="flex flex-col items-center text-center">
                <div className="grid h-[clamp(44px,3.6vw,58px)] w-[clamp(44px,3.6vw,58px)] place-items-center rounded-[10px] border border-white/[0.18] text-[#d8d2ca]">
                  <step.icon className="h-[44%] w-[44%]" strokeWidth={1.4} />
                </div>
                <div className="mt-[clamp(10px,1.2vh,18px)] text-[clamp(13px,1vw,17px)] font-medium text-white">
                  {step.label}
                </div>
                <div className="mt-1 max-w-[140px] text-[clamp(10.5px,0.75vw,12.5px)] leading-[1.4] text-[#807970]">
                  {step.sub}
                </div>
              </div>
              {i < steps.length - 1 && (
                <div
                  className="mt-[clamp(20px,1.7vw,28px)] h-px shrink-0 grow-0 self-start"
                  style={{
                    flex: '1 1 0',
                    backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.30) 1px, transparent 1.5px)',
                    backgroundSize: '6px 1px',
                    backgroundRepeat: 'repeat-x',
                    backgroundPosition: 'center',
                    height: '2px',
                  }}
                />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FlowSection;

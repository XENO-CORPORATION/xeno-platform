import React from 'react';
import { Reveal, cx } from './primitives';

/* Honest credibility layer — the frontier model providers XENO routes to.
   Text wordmarks (not logos) to avoid trademark/asset issues; no fabricated
   testimonials, customer logos, or usage numbers. */
const providers = [
  'OpenAI',
  'Anthropic',
  'Google',
  'Meta',
  'Mistral',
  'Black Forest Labs',
  'Stability AI',
  'ElevenLabs',
];

const ModelsStrip: React.FC = () => {
  return (
    <section className="page-gutter border-t border-white/[0.06] bg-[#060606] py-[clamp(40px,6vh,72px)]">
      <Reveal className="mx-auto flex flex-col items-center gap-[clamp(20px,3vh,34px)]">
        <p className="text-center text-[clamp(10.5px,0.78vw,12.5px)] font-semibold uppercase tracking-[0.2em] text-[#756f66]">
          One workspace · every frontier model
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-[clamp(22px,3.6vw,60px)] gap-y-[clamp(10px,1.6vh,18px)]">
          {providers.map((m, i) => (
            <Reveal
              key={m}
              as="span"
              delay={i * 40}
              className={cx(
                'text-[clamp(13px,1.25vw,19px)] font-medium tracking-tight text-[#6f685f] transition-colors duration-200 hover:text-[#cdc7be]',
              )}
            >
              {m}
            </Reveal>
          ))}
        </div>
      </Reveal>
    </section>
  );
};

export default ModelsStrip;

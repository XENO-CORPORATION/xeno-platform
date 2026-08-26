import React from 'react';
import { ArrowRight, Download } from 'lucide-react';
import { Reveal } from './primitives';

const CreateWithoutLimitsSection: React.FC = () => {
  return (
    <section className="page-gutter bg-[#060606] pb-[clamp(40px,5vh,72px)] pt-[clamp(24px,3vh,48px)]">
      <Reveal>
        <div className="relative mx-auto w-full overflow-hidden rounded-[20px] border border-white/[0.08]">
          {/* ── Backdrop: deep space + planet limb on the right ── */}
          <div
            className="absolute inset-0"
            style={{
              backgroundColor: '#060606',
              backgroundImage: `
                radial-gradient(1.4px 1.4px at 12% 28%, rgba(255,255,255,0.85), transparent 60%),
                radial-gradient(1px 1px at 28% 62%, rgba(255,255,255,0.7), transparent 60%),
                radial-gradient(1px 1px at 41% 18%, rgba(255,255,255,0.55), transparent 60%),
                radial-gradient(1.4px 1.4px at 9% 78%, rgba(255,255,255,0.7), transparent 60%),
                radial-gradient(1px 1px at 22% 12%, rgba(255,255,255,0.6), transparent 60%),
                radial-gradient(1px 1px at 35% 47%, rgba(255,255,255,0.5), transparent 60%),
                radial-gradient(0.8px 0.8px at 17% 52%, rgba(255,255,255,0.45), transparent 60%),
                radial-gradient(1px 1px at 4% 30%, rgba(255,255,255,0.55), transparent 60%),
                radial-gradient(0.8px 0.8px at 31% 84%, rgba(255,255,255,0.45), transparent 60%),
                radial-gradient(1px 1px at 47% 70%, rgba(255,255,255,0.5), transparent 60%)
              `,
            }}
          />
          {/* Planet on the right edge — earth-toned curved limb */}
          <div
            className="absolute inset-0"
            style={{
              background: `
                radial-gradient(circle 720px at 105% 60%, rgba(220,190,160,0.55) 0%, rgba(120,90,70,0.55) 18%, rgba(40,30,25,0.95) 32%, transparent 45%),
                radial-gradient(circle 920px at 110% 60%, rgba(255, 255, 255,0.16) 28%, transparent 40%),
                radial-gradient(circle 1100px at 115% 60%, rgba(120,160,210,0.08) 30%, transparent 36%)
              `,
            }}
          />
          {/* Generated cosmic background — covers the CSS fallback above once loaded */}
          <img
            src="/landing-v3/cta-space.png"
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          />
          {/* Soft vignette so text reads cleanly */}
          <div
            className="absolute inset-0"
            style={{ background: 'radial-gradient(ellipse at 38% 50%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.45) 65%, rgba(0,0,0,0.78) 100%)' }}
          />

          {/* ── Content ─────────────────────────────────────── */}
          <div className="relative z-10 flex flex-col items-center justify-center px-[clamp(20px,2vw,48px)] py-[clamp(64px,11vh,160px)] text-center">
            <span className="text-[clamp(10.5px,0.75vw,12px)] font-semibold uppercase tracking-[0.24em] text-[#9a8f84]">
              Your workspace awaits
            </span>
            <h2
              className="mt-[clamp(16px,2vh,28px)] text-[clamp(2.4rem,4.4vw,5rem)] leading-[1.04] tracking-[0.01em] text-white"
              style={{ fontFamily: "'Cormorant Garamond', 'Playfair Display', Georgia, serif", fontWeight: 400 }}
            >
              Create without limits.
            </h2>
            <p className="mt-[clamp(14px,1.8vh,22px)] max-w-[440px] text-[clamp(13px,1vw,16px)] leading-[1.6] text-[#b6afa5]">
              Your ideas. Our AI. One workspace where imagination becomes reality.
            </p>

            <div className="mt-[clamp(28px,3.6vh,48px)] flex flex-col items-center gap-3 sm:flex-row">
              <a
                href="/signup"
                className="group inline-flex h-[clamp(46px,4.6vh,54px)] items-center gap-2.5 rounded-[9px] bg-white px-[clamp(20px,1.8vw,30px)] text-[clamp(12.5px,0.9vw,14.5px)] font-semibold text-black transition-colors hover:bg-white/90"
              >
                Get started free
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </a>
              <a
                href="/download"
                className="inline-flex h-[clamp(46px,4.6vh,54px)] items-center gap-2.5 rounded-[9px] border border-white/20 bg-white/[0.03] px-[clamp(20px,1.8vw,30px)] text-[clamp(12.5px,0.9vw,14.5px)] font-medium text-white backdrop-blur-sm transition-colors hover:border-white/35 hover:bg-white/[0.06]"
              >
                Download XENO
                <Download className="h-4 w-4 stroke-[1.6]" />
              </a>
            </div>

            <p className="mt-[clamp(16px,2vh,26px)] text-[clamp(11px,0.78vw,12.5px)] text-[#807970]">
              Free workspace · No credit card required
            </p>
          </div>
        </div>
      </Reveal>
    </section>
  );
};

export default CreateWithoutLimitsSection;

import React from 'react';
import { Download } from 'lucide-react';

const CreateWithoutLimitsSection: React.FC = () => {
  return (
    <section className="bg-[#060606] px-[1vw] pb-[clamp(40px,5vh,72px)] pt-[clamp(20px,2.4vh,40px)]">
      <div className="relative mx-auto w-full overflow-hidden rounded-[16px] border border-white/[0.08]">
        {/* ── Backdrop: deep space + planet limb on the right ── */}
        {/* Star field (subtle dotted background) */}
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
              radial-gradient(circle 920px at 110% 60%, rgba(140,170,210,0.20) 28%, transparent 40%),
              radial-gradient(circle 1100px at 115% 60%, rgba(120,160,210,0.08) 30%, transparent 36%)
            `,
          }}
        />
        {/* Soft top-down vignette so text reads cleanly */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse at 38% 50%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.45) 65%, rgba(0,0,0,0.75) 100%)',
          }}
        />

        {/* ── Content ─────────────────────────────────────── */}
        <div className="relative z-10 flex flex-col items-center justify-center px-[clamp(20px,2vw,48px)] py-[clamp(56px,9vh,140px)] text-center">
          <h2 className="text-[clamp(2rem,3vw,3.6rem)] font-light leading-[1.1] tracking-tight text-white">
            Create without limits.
          </h2>
          <p className="mt-[clamp(10px,1.4vh,18px)] text-[clamp(13px,1vw,16px)] text-[#aaa39a]">
            Your ideas. Our AI. Infinite possibilities.
          </p>
          <a
            href="/download"
            className="mt-[clamp(24px,3.2vh,44px)] inline-flex h-[clamp(44px,4.4vh,52px)] items-center gap-3 rounded-[8px] bg-white px-[clamp(18px,1.6vw,28px)] text-[clamp(12.5px,0.9vw,14.5px)] font-semibold text-black transition-colors hover:bg-white/95"
          >
            Download XENO
            <Download className="h-4 w-4 stroke-[1.6]" />
          </a>
        </div>
      </div>
    </section>
  );
};

export default CreateWithoutLimitsSection;

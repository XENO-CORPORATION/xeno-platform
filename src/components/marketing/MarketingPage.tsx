import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Check } from 'lucide-react';
import Header from '../landing-v3/Header';
import Footer from '../landing-v3/Footer';
import { Reveal } from '../landing-v3/primitives';

/* Shared layout for all secondary marketing/legal/resource pages. Header + hero
   + content + Footer on the canonical v3 dark theme, with the sticky-footer flex
   layout. Compose the exported blocks for consistent content. */

export const MarketingPage: React.FC<{
  eyebrow?: string;
  title: string;
  subtitle?: string;
  updated?: string;
  children: React.ReactNode;
}> = ({ eyebrow, title, subtitle, updated, children }) => {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen flex-col bg-[#060606] text-white font-['Inter',sans-serif] overflow-x-clip antialiased">
      <Header onGetStarted={() => navigate('/auth')} visible={true} />
      <main className="flex-1">
        <section className="page-gutter relative overflow-hidden pt-[clamp(92px,12vh,140px)] pb-[clamp(24px,4vh,48px)]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[360px] bg-[radial-gradient(ellipse_55%_75%_at_50%_-10%,rgba(255, 255, 255,0.10),transparent_70%)]" />
          <div className="relative mx-auto max-w-[880px]">
            <Reveal>
              <Link to="/" className="inline-flex items-center gap-1.5 text-[12.5px] text-[#69635b] transition-colors hover:text-[#cdc7be]">
                <ArrowLeft className="h-3.5 w-3.5" /> Home
              </Link>
            </Reveal>
            {eyebrow && (
              <Reveal delay={40}>
                <div className="mt-6 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#e8e3dc]">{eyebrow}</div>
              </Reveal>
            )}
            <Reveal delay={80}>
              <h1 className="mt-3 text-[clamp(2.2rem,4vw,3.4rem)] font-semibold leading-[1.05] tracking-[-0.02em] text-[#ece7df]">{title}</h1>
            </Reveal>
            {subtitle && (
              <Reveal delay={120}>
                <p className="mt-4 max-w-[640px] text-[clamp(14px,1.1vw,17px)] leading-[1.6] text-[#948d83]">{subtitle}</p>
              </Reveal>
            )}
            {updated && (
              <Reveal delay={140}>
                <p className="mt-3 text-[12px] text-[#69635b]">Last updated: {updated}</p>
              </Reveal>
            )}
          </div>
        </section>
        <section className="page-gutter pb-[clamp(56px,8vh,110px)]">
          <div className="mx-auto max-w-[880px]">{children}</div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

/* ── Content blocks ─────────────────────────────────────────────────────── */

export const Section: React.FC<{ title?: string; children: React.ReactNode; className?: string }> = ({ title, children, className = '' }) => (
  <div className={`mt-12 first:mt-0 ${className}`}>
    {title && <h2 className="mb-5 text-[clamp(1.2rem,2vw,1.7rem)] font-semibold tracking-[-0.01em] text-[#ece7df]">{title}</h2>}
    {children}
  </div>
);

/** Legal / long-form prose. Pass an array of { h?, p } blocks. */
export const Prose: React.FC<{ blocks: { h?: string; p: React.ReactNode }[] }> = ({ blocks }) => (
  <div className="space-y-7">
    {blocks.map((b, i) => (
      <div key={i}>
        {b.h && <h3 className="mb-2.5 text-[15px] font-semibold text-[#e3ded5]">{b.h}</h3>}
        <p className="text-[14px] leading-[1.75] text-[#9b948a]">{b.p}</p>
      </div>
    ))}
  </div>
);

export const FeatureGrid: React.FC<{ items: { title: string; desc: string }[]; cols?: 2 | 3 }> = ({ items, cols = 2 }) => (
  <div className={`grid grid-cols-1 gap-3 ${cols === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'}`}>
    {items.map((it) => (
      <div key={it.title} className="rounded-[12px] border border-white/[0.07] bg-[#0d0d0d] p-5 transition-colors hover:border-white/[0.13]">
        <h3 className="mb-1.5 text-[14px] font-semibold text-[#ece7df]">{it.title}</h3>
        <p className="text-[12.5px] leading-[1.55] text-[#948d83]">{it.desc}</p>
      </div>
    ))}
  </div>
);

/** Bulleted check-list. */
export const CheckList: React.FC<{ items: string[] }> = ({ items }) => (
  <ul className="space-y-2.5">
    {items.map((it) => (
      <li key={it} className="flex items-start gap-2.5 text-[13.5px] leading-[1.55] text-[#b6afa5]">
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#e8e3dc]" />
        <span>{it}</span>
      </li>
    ))}
  </ul>
);

/** CTA band. */
export const CTA: React.FC<{ title: string; desc?: string; href: string; label: string }> = ({ title, desc, href, label }) => (
  <div className="mt-14 flex flex-col items-start gap-4 rounded-[16px] border border-white/[0.08] bg-[#0d0d0d] p-7 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <h3 className="text-[16px] font-semibold text-[#ece7df]">{title}</h3>
      {desc && <p className="mt-1 text-[13px] text-[#948d83]">{desc}</p>}
    </div>
    <Link to={href} className="shrink-0 rounded-[9px] bg-white px-5 py-2.5 text-[13.5px] font-semibold text-black transition-colors hover:bg-white/90">{label}</Link>
  </div>
);

export default MarketingPage;

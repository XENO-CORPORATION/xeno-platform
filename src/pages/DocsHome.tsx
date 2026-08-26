import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ArrowRight, BookOpen } from 'lucide-react';
import MarketingPage, { Section } from '../components/marketing/MarketingPage';
import DocsSearch from '../components/docs/DocsSearch';
import { allDocProducts, DOCUMENTED_SLUGS } from '../content/docs';
import { getProduct } from '../lib/productCatalog';

/* /docs — the unified XENO Studio documentation hub. Documented products link
 * into /docs/<slug>; everything else shows a "coming soon" card. */

// Products to surface as "coming soon" until their docs are authored.
const COMING_SOON = ['hub', 'pixel', 'motion', 'sound', 'canvas', 'comms', 'post', 'browser'];

const DocsHome: React.FC = () => {
  const [searchOpen, setSearchOpen] = useState(false);
  const documented = allDocProducts();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <MarketingPage
      eyebrow="DOCUMENTATION"
      title="XENO Studio docs"
      subtitle="Guides and reference for every XENO app, agent, and API — from your first render to a production agent workflow."
      updated="July 2026"
    >
      <DocsSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

      <button
        onClick={() => setSearchOpen(true)}
        className="flex w-full items-center justify-between rounded-[12px] border border-white/[0.09] bg-[#0d0d0d] px-4 py-3.5 text-left transition-colors hover:border-white/[0.18]"
      >
        <span className="inline-flex items-center gap-2.5 text-[14px] text-[#827b71]"><Search className="h-4 w-4" /> Search the documentation…</span>
        <kbd className="rounded-[5px] border border-white/[0.12] px-2 py-0.5 font-mono text-[11px] text-[#69635b]">⌘K</kbd>
      </button>

      <Section title="Browse by product">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {documented.map((p) => (
            <Link
              key={p.slug}
              to={`/docs/${p.slug}`}
              className="group flex flex-col rounded-[14px] border border-white/25 bg-white/[0.05] p-5 transition-colors hover:border-white/45"
            >
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-[#e8e3dc]" />
                <span className="text-[15px] font-semibold text-[#ece7df]">{p.productName}</span>
              </div>
              <p className="mt-2 flex-1 text-[13px] leading-[1.6] text-[#948d83]">{p.tagline}</p>
              <span className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#e8e3dc] transition-colors group-hover:text-white">
                Read the docs <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          ))}

          {COMING_SOON.filter((s) => !DOCUMENTED_SLUGS.includes(s)).map((slug) => {
            const prod = getProduct(slug);
            if (!prod) return null;
            return (
              <div key={slug} className="flex flex-col rounded-[14px] border border-white/[0.06] bg-[#0b0b0b] p-5 opacity-70">
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-semibold text-[#cdc7be]">{prod.name}</span>
                  <span className="rounded-[4px] border border-white/[0.10] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#756f66]">Soon</span>
                </div>
                <p className="mt-2 text-[13px] leading-[1.6] text-[#827b71]">{prod.tagline}</p>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Get started">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            { title: 'Create an account', desc: 'Sign up at xenostudio.ai for your workspace and access to the XENO platform.' },
            { title: 'Install Hub', desc: 'The desktop launcher installs, updates, and opens every creative app and signs you in once.' },
            { title: 'Use the developer API', desc: 'Create an API key, review usage-based inference billing, and call supported models from your own software.' },
            { title: 'Connect the CLI', desc: 'Install the Agent CLI, add an API key, and drive generation and agents from your terminal.' },
          ].map((s) => (
            <div key={s.title} className="rounded-[12px] border border-white/[0.07] bg-[#0d0d0d] p-4">
              <div className="text-[14px] font-semibold text-[#e3ded5]">{s.title}</div>
              <p className="mt-1.5 text-[13px] leading-[1.6] text-[#948d83]">{s.desc}</p>
            </div>
          ))}
        </div>
      </Section>

      <div className="mt-12 flex flex-col items-start gap-3 rounded-[14px] border border-white/[0.07] bg-[#0d0d0d] p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-[15px] font-semibold text-[#ece7df]">Prefer learning by doing?</div>
          <p className="mt-1 text-[13px] text-[#948d83]">Step-by-step tutorials walk you through real projects in every XENO app.</p>
        </div>
        <Link to="/learn" className="inline-flex shrink-0 items-center gap-2 rounded-[9px] bg-white px-4 py-2.5 text-[13px] font-semibold text-black transition-colors hover:bg-white/90">
          Browse tutorials <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </MarketingPage>
  );
};

export default DocsHome;

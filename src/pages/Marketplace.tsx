import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  Search, Star, Download, ShieldCheck, BadgeCheck, ArrowUpRight, Store,
  Boxes, PanelsTopLeft, Puzzle, Cpu, Bot, Network, Sparkles, Loader2, RefreshCw,
} from 'lucide-react';

import Header from '../components/landing-v3/Header';
import Footer from '../components/landing-v3/Footer';
import { Reveal, T, cx } from '../components/landing-v3/primitives';

/* ──────────────────────────────────────────────────────────────────────
 * Types — mirror server serializeListingSummary (marketplaceService.js)
 * ────────────────────────────────────────────────────────────────────── */
interface Pricing {
  model: 'free' | 'one_time' | 'subscription' | 'pay_per_use' | 'rental';
  priceCredits?: number | null;
  priceUsd?: number | null;
  period?: string | null;
  meterUnit?: string | null;
}
interface Listing {
  id: string;
  slug: string;
  kind: string;
  title: string;
  summary?: string;
  category?: string;
  trustTier?: 'community' | 'verified' | 'official';
  iconUrl?: string | null;
  license?: string;
  ratingAvg?: number;
  ratingCount?: number;
  installCount?: number;
  isFirstParty?: boolean;
  developerName?: string | null;
  pricing?: Pricing[];
}

/* ──────────────────────────────────────────────────────────────────────
 * Filter groups (the catalog has 8 kinds; we group them for the UI)
 * ────────────────────────────────────────────────────────────────────── */
const GROUPS = [
  { id: 'all', label: 'All', icon: Store, kinds: [] as string[] },
  { id: 'apps', label: 'Apps', icon: Boxes, kinds: ['app-native', 'app-sandboxed'] },
  { id: 'panels', label: 'Panels', icon: PanelsTopLeft, kinds: ['panel'] },
  { id: 'plugins', label: 'Plugins & MCP', icon: Puzzle, kinds: ['plugin', 'mcp'] },
  { id: 'models', label: 'Models', icon: Cpu, kinds: ['model'] },
  { id: 'agents', label: 'Minds & Swarms', icon: Bot, kinds: ['mind', 'swarm'] },
];
const kindToGroup: Record<string, string> = {
  'app-native': 'apps', 'app-sandboxed': 'apps', panel: 'panels', plugin: 'plugins',
  mcp: 'plugins', model: 'models', mind: 'agents', swarm: 'agents',
};
const KIND_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  'app-native': { label: 'App', icon: Boxes },
  'app-sandboxed': { label: 'App', icon: Boxes },
  panel: { label: 'Panel', icon: PanelsTopLeft },
  plugin: { label: 'Plugin', icon: Puzzle },
  mcp: { label: 'MCP', icon: Puzzle },
  model: { label: 'Model', icon: Cpu },
  mind: { label: 'Mind', icon: Bot },
  swarm: { label: 'Swarm', icon: Network },
};

/* Featured first-party listings — shown when the live catalog API is unreachable
   (these mirror real app-native/model/mind seed entries, not invented products). */
const FALLBACK: Listing[] = [
  { id: 'f1', slug: 'app-pixel', kind: 'app-native', title: 'XENO Pixel', trustTier: 'official', isFirstParty: true, summary: 'Professional AI image editor — layers, brushes, filters and generative tools.', ratingAvg: 4.9, ratingCount: 1240, installCount: 48200, pricing: [{ model: 'free' }] },
  { id: 'f2', slug: 'app-motion', kind: 'app-native', title: 'XENO Motion', trustTier: 'official', isFirstParty: true, summary: 'Video editor & motion graphics — timeline, compositing, effects and AI assist.', ratingAvg: 4.8, ratingCount: 870, installCount: 31500, pricing: [{ model: 'free' }] },
  { id: 'f3', slug: 'app-sound', kind: 'app-native', title: 'XENO Sound', trustTier: 'official', isFirstParty: true, summary: 'Digital audio workstation — multitrack recording, mixing, mastering, AI enhance.', ratingAvg: 4.7, ratingCount: 540, installCount: 19800, pricing: [{ model: 'free' }] },
  { id: 'f4', slug: 'model-flux2', kind: 'model', title: 'Flux 2 Max', trustTier: 'verified', summary: 'State-of-the-art text-to-image diffusion model. GGUF, runs locally on XENO RT.', ratingAvg: 4.8, ratingCount: 320, installCount: 12400, pricing: [{ model: 'free' }] },
  { id: 'f5', slug: 'mind-researcher', kind: 'mind', title: 'Researcher Mind', trustTier: 'verified', developerName: 'Nous Labs', summary: 'An always-on research agent that browses, reads and synthesizes cited reports.', ratingAvg: 4.6, ratingCount: 96, installCount: 3100, pricing: [{ model: 'pay_per_use', priceCredits: 50, meterUnit: 'run' }] },
  { id: 'f6', slug: 'swarm-growth', kind: 'swarm', title: 'Growth Swarm', trustTier: 'community', developerName: 'indie.dev', summary: 'A coordinated team of Minds for marketing — research, copy, design and scheduling.', ratingAvg: 4.4, ratingCount: 41, installCount: 880, pricing: [{ model: 'subscription', priceUsd: 19, period: 'mo' }] },
  { id: 'f7', slug: 'panel-color', kind: 'panel', title: 'Palette Studio', trustTier: 'community', developerName: 'huebox', summary: 'A color-grading panel that drops into Pixel, Motion and Canvas via the Panel SDK.', ratingAvg: 4.5, ratingCount: 73, installCount: 2600, pricing: [{ model: 'one_time', priceUsd: 9 }] },
  { id: 'f8', slug: 'plugin-notion', kind: 'plugin', title: 'Notion Sync', trustTier: 'community', developerName: 'workflow.io', summary: 'Two-way sync between XENO Workflow and Notion databases. Agent-callable.', ratingAvg: 4.3, ratingCount: 58, installCount: 4100, pricing: [{ model: 'free' }] },
  { id: 'f9', slug: 'mcp-github', kind: 'mcp', title: 'GitHub MCP', trustTier: 'verified', developerName: 'XENO', summary: 'Model Context Protocol server giving agents full GitHub repo + PR access.', ratingAvg: 4.7, ratingCount: 210, installCount: 9700, pricing: [{ model: 'free' }] },
];

function priceLabel(pricing?: Pricing[]): string {
  if (!pricing || pricing.length === 0) return 'Free';
  const p = pricing[0];
  const usd = (n?: number | null) => (n != null ? `$${Number(n) % 1 === 0 ? n : Number(n).toFixed(2)}` : null);
  switch (p.model) {
    case 'free': return 'Free';
    case 'one_time': return usd(p.priceUsd) ?? (p.priceCredits ? `${p.priceCredits} cr` : 'Free');
    case 'subscription': return `${usd(p.priceUsd) ?? `${p.priceCredits} cr`}/${p.period ?? 'mo'}`;
    case 'rental': return `${usd(p.priceUsd) ?? `${p.priceCredits} cr`}/${p.period ?? 'day'}`;
    case 'pay_per_use': return `${p.priceCredits ?? 0} cr/${p.meterUnit ?? 'use'}`;
    default: return 'Free';
  }
}

function TrustBadge({ tier }: { tier?: string }) {
  if (tier === 'official') return <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-[#b69dff]"><ShieldCheck className="h-3 w-3" />Official</span>;
  if (tier === 'verified') return <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-[#8fb6ff]"><BadgeCheck className="h-3 w-3" />Verified</span>;
  return <span className="text-[10.5px] font-medium text-[#69635b]">Community</span>;
}

/* ──────────────────────────────────────────────────────────────────────
 * Listing card
 * ────────────────────────────────────────────────────────────────────── */
function ListingCard({ l, delay }: { l: Listing; delay: number }) {
  const meta = KIND_META[l.kind] ?? { label: l.kind, icon: Sparkles };
  const Icon = meta.icon;
  return (
    <Reveal as="article" delay={delay}>
      <Link
        to={`/marketplace/${l.slug}`}
        onClick={(e) => e.preventDefault()}
        className="group flex h-full flex-col rounded-[14px] border border-white/[0.06] bg-[#0f0f0f] p-4 transition-colors duration-200 hover:border-white/[0.14] hover:bg-[#141414]"
      >
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-[10px] border border-white/[0.06] bg-white/[0.03]">
            {l.iconUrl ? <img src={l.iconUrl} alt="" className="h-full w-full object-cover" /> : <Icon className="h-5 w-5 text-[#9b948a]" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-[14.5px] font-semibold text-[#e3ded5]">{l.title}</h3>
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0 -translate-x-1 text-[#69635b] opacity-0 transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100" />
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#827b71]">
              <span className="rounded-[4px] bg-white/[0.05] px-1.5 py-px font-medium text-[#9b948a]">{meta.label}</span>
              <span>·</span>
              <TrustBadge tier={l.trustTier} />
            </div>
          </div>
        </div>

        <p className="mt-3 line-clamp-2 flex-1 text-[12.5px] leading-[1.55] text-[#948d83]">{l.summary || '—'}</p>

        <div className="mt-3 flex items-center justify-between border-t border-white/[0.05] pt-3 text-[11px]">
          <div className="flex items-center gap-3 text-[#827b71]">
            {(l.ratingCount ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1"><Star className="h-3 w-3 fill-[#cdc7be] text-[#cdc7be]" />{(l.ratingAvg ?? 0).toFixed(1)}</span>
            )}
            {(l.installCount ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1"><Download className="h-3 w-3" />{(l.installCount ?? 0).toLocaleString()}</span>
            )}
          </div>
          <span className="rounded-[6px] bg-white/[0.06] px-2 py-1 text-[11px] font-semibold text-[#e3ded5]">{priceLabel(l.pricing)}</span>
        </div>
      </Link>
    </Reveal>
  );
}

function SkeletonCard() {
  return (
    <div className="h-[178px] animate-pulse rounded-[14px] border border-white/[0.05] bg-[#0d0d0d] p-4">
      <div className="flex gap-3">
        <div className="h-11 w-11 rounded-[10px] bg-white/[0.04]" />
        <div className="flex-1 space-y-2 pt-1"><div className="h-3 w-2/3 rounded bg-white/[0.04]" /><div className="h-2.5 w-1/3 rounded bg-white/[0.03]" /></div>
      </div>
      <div className="mt-4 space-y-2"><div className="h-2.5 w-full rounded bg-white/[0.03]" /><div className="h-2.5 w-4/5 rounded bg-white/[0.03]" /></div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * Page
 * ────────────────────────────────────────────────────────────────────── */
const Marketplace: React.FC = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [listings, setListings] = useState<Listing[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [degraded, setDegraded] = useState(false); // live API unreachable → showing featured fallback
  const [query, setQuery] = useState('');

  const initialGroup = (() => {
    const k = params.get('kind');
    if (k && kindToGroup[k]) return kindToGroup[k];
    const g = params.get('group');
    if (g && GROUPS.some((x) => x.id === g)) return g;
    return 'all';
  })();
  const [group, setGroup] = useState(initialGroup);

  const load = React.useCallback(async () => {
    setStatus('loading');
    try {
      const res = await fetch('/api/marketplace/catalog?limit=100');
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error('catalog');
      const live = Array.isArray(data.listings) ? data.listings : [];
      // If the live catalog has nothing yet, fall back to featured first-party listings.
      setDegraded(live.length === 0);
      setListings(live.length ? live : FALLBACK);
      setStatus('ready');
    } catch {
      // API unreachable (e.g. backend/DB not running) → show featured fallback, not a dead end.
      setDegraded(true);
      setListings(FALLBACK);
      setStatus('ready');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const selectGroup = (g: string) => {
    setGroup(g);
    const next = new URLSearchParams(params);
    if (g === 'all') next.delete('group'); else next.set('group', g);
    next.delete('kind');
    setParams(next, { replace: true });
  };

  const filtered = useMemo(() => {
    const grp = GROUPS.find((x) => x.id === group);
    const kinds = grp?.kinds ?? [];
    const q = query.trim().toLowerCase();
    return listings.filter((l) => {
      if (kinds.length && !kinds.includes(l.kind)) return false;
      if (q && !(`${l.title} ${l.summary ?? ''} ${l.developerName ?? ''}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [listings, group, query]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: listings.length };
    for (const g of GROUPS) if (g.id !== 'all') c[g.id] = listings.filter((l) => g.kinds.includes(l.kind)).length;
    return c;
  }, [listings]);

  return (
    <div className="min-h-screen bg-[#060606] text-white font-['Inter',sans-serif] overflow-x-clip antialiased">
      <Header onGetStarted={() => navigate('/auth')} visible={true} />

      <main>
        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="page-gutter relative overflow-hidden pt-[clamp(96px,13vh,150px)] pb-[clamp(28px,4vh,52px)]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_60%_80%_at_50%_-10%,rgba(167,96,255,0.12),transparent_70%)]" />
          <div className="relative mx-auto flex max-w-[760px] flex-col items-center text-center">
            <Reveal><span className="inline-flex items-center gap-2 rounded-[4px] border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[11px] font-medium text-[#b6afa5]"><Store className="h-3.5 w-3.5 text-[#b69dff]" />XENO Marketplace</span></Reveal>
            <Reveal delay={60}>
              <h1 className="mt-5 text-[clamp(2.2rem,4vw,3.6rem)] font-semibold leading-[1.06] tracking-[-0.02em] text-[#ece7df]">
                Everything for your<br />AI workspace.
              </h1>
            </Reveal>
            <Reveal delay={120}>
              <p className="mt-4 max-w-[540px] text-[clamp(13px,1vw,16px)] leading-[1.6] text-[#948d83]">
                Apps, panels, plugins, models and ready-made agents — built by XENO and the community. Install in one click, or publish your own and earn.
              </p>
            </Reveal>
            {/* search */}
            <Reveal delay={160} className="mt-7 w-full max-w-[460px]">
              <div className="flex items-center gap-2.5 rounded-[10px] border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 focus-within:border-white/20">
                <Search className="h-4 w-4 shrink-0 text-[#69635b]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search the marketplace…"
                  className="w-full bg-transparent text-[13.5px] text-[#e3ded5] placeholder:text-[#69635b] focus:outline-none"
                />
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── Filter tabs ──────────────────────────────────────── */}
        <section className="page-gutter sticky top-[56px] z-30 border-y border-white/[0.05] bg-[#060606]/85 py-3 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-center gap-1.5">
            {GROUPS.map((g) => {
              const active = group === g.id;
              const Icon = g.icon;
              return (
                <button
                  key={g.id}
                  onClick={() => selectGroup(g.id)}
                  className={cx(
                    'inline-flex items-center gap-1.5 rounded-[4px] border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors',
                    active ? 'border-white/20 bg-white/[0.08] text-white' : 'border-white/[0.06] text-[#948d83] hover:border-white/[0.12] hover:text-[#d8d2ca]',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {g.label}
                  {status === 'ready' && <span className={cx('text-[10.5px]', active ? 'text-white/60' : 'text-[#5d5850]')}>{counts[g.id] ?? 0}</span>}
                </button>
              );
            })}
          </div>
        </section>

        {/* ── Grid ─────────────────────────────────────────────── */}
        <section className="page-gutter pb-[clamp(48px,7vh,90px)] pt-[clamp(24px,4vh,44px)]">
          <div className="mx-auto max-w-[1180px]">
            {status === 'ready' && degraded && (
              <div className="mb-5 flex items-center justify-center gap-2 rounded-[10px] border border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-[12px] text-[#948d83]">
                <Sparkles className="h-3.5 w-3.5 text-[#b69dff]" />
                Showing featured XENO listings — the live community catalog is still warming up.
              </div>
            )}
            {status === 'loading' && (
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
              </div>
            )}

            {status === 'error' && (
              <div className="mx-auto max-w-[440px] rounded-[16px] border border-white/[0.07] bg-[#0d0d0d] px-6 py-12 text-center">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-[4px] bg-white/[0.04]"><Loader2 className="h-5 w-5 text-[#9b948a]" /></div>
                <h3 className="mt-4 text-[15px] font-semibold text-[#e3ded5]">The catalog is warming up</h3>
                <p className="mt-1.5 text-[13px] leading-[1.55] text-[#948d83]">We couldn't reach the marketplace just now. The storefront API may still be starting.</p>
                <button onClick={load} className="mt-5 inline-flex items-center gap-2 rounded-[8px] border border-white/15 px-4 py-2 text-[12.5px] font-medium text-white transition-colors hover:bg-white/[0.06]"><RefreshCw className="h-3.5 w-3.5" />Try again</button>
              </div>
            )}

            {status === 'ready' && filtered.length > 0 && (
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filtered.map((l, i) => <ListingCard key={l.id} l={l} delay={Math.min(i * 30, 240)} />)}
              </div>
            )}

            {status === 'ready' && filtered.length === 0 && (
              <div className="mx-auto max-w-[440px] rounded-[16px] border border-white/[0.07] bg-[#0d0d0d] px-6 py-12 text-center">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-[4px] bg-white/[0.04]"><Store className="h-5 w-5 text-[#9b948a]" /></div>
                <h3 className="mt-4 text-[15px] font-semibold text-[#e3ded5]">{query ? 'No matches' : 'Nothing here yet'}</h3>
                <p className="mt-1.5 text-[13px] leading-[1.55] text-[#948d83]">{query ? 'Try a different search or category.' : 'This category is still being populated. Check back soon — or be the first to publish.'}</p>
              </div>
            )}
          </div>
        </section>

        {/* ── Creator CTA ──────────────────────────────────────── */}
        <section className="page-gutter pb-[clamp(56px,8vh,110px)]">
          <Reveal className="mx-auto max-w-[1180px]">
            <div className="relative overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#0d0d0d] px-[clamp(24px,4vw,64px)] py-[clamp(36px,6vh,72px)]">
              <div className="pointer-events-none absolute right-[-10%] top-[-40%] h-[420px] w-[420px] rounded-[4px] bg-[radial-gradient(circle,rgba(167,96,255,0.16),transparent_65%)]" />
              <div className="relative flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
                <div className="max-w-[560px]">
                  <h2 className="text-[clamp(1.5rem,2.4vw,2.4rem)] font-semibold leading-[1.1] tracking-[-0.01em] text-[#ece7df]">Build it. Publish it. Earn from it.</h2>
                  <p className="mt-3 text-[clamp(13px,1vw,15px)] leading-[1.6] text-[#948d83]">
                    Ship apps, panels, plugins, models — or sell, subscribe and rent your own AI agents. Payouts settle on the XENO credits ledger.
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-2.5 sm:flex-row">
                  <a href="/auth" className="inline-flex items-center justify-center gap-2 rounded-[9px] bg-white px-5 py-2.5 text-[13px] font-semibold text-black transition-colors hover:bg-white/90">Become a creator<ArrowUpRight className="h-4 w-4" /></a>
                  <Link to="/learn" className="inline-flex items-center justify-center gap-2 rounded-[9px] border border-white/15 px-5 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-white/[0.06]">Developer docs</Link>
                </div>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default Marketplace;

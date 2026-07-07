import React from 'react';
import {
  Search, Store, AppWindow, Boxes, Bot, Plug, Cpu, Download, ShoppingCart, Star,
} from 'lucide-react';
import { Reveal } from '../../landing-v3/primitives';

/* XENO Hub — Marketplace (Store tab) mockup, for the landing gallery. Recreates
 * xeno-hub/src/renderer/components/store/StorePage: the shelf rail (All / XENO
 * Apps / Community Apps / Agents / Panels & Plugins / Models), search, and
 * content-typed listing cards with trust tiers (Official / Verified / Community)
 * and pricing (free / credits / subscription / rental). Landing-v3 language;
 * accent via .acc-* / rgb(var(--acc)); trust-tier colors are fixed product
 * semantics matching the real UI. */

const shelves = [
  { id: 'all', label: 'All', icon: Store, active: true },
  { id: 'apps', label: 'XENO Apps', icon: AppWindow },
  { id: 'community', label: 'Community Apps', icon: Boxes },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'plugins', label: 'Panels & Plugins', icon: Plug },
  { id: 'models', label: 'Models', icon: Cpu },
];

type Trust = 'official' | 'verified' | 'community';
const trustCls: Record<Trust, string> = {
  official: 'text-emerald-300/70 bg-emerald-400/[0.07] border-emerald-300/[0.14]',
  verified: 'text-[#cdc7be] bg-white/[0.06] border-white/[0.10]',
  community: 'text-amber-300/70 bg-amber-400/[0.07] border-amber-300/[0.14]',
};
const trustLabel: Record<Trust, string> = { official: 'Official', verified: 'Verified', community: 'Community' };

const listings: {
  title: string; kind: string; trust: Trust; summary: string; price: string; rating: string; icon: typeof Bot; buy?: boolean;
}[] = [
  { title: 'XENO Pixel', kind: 'Native App', trust: 'official', summary: 'Image & vector editor', price: 'Free', rating: '4.9', icon: AppWindow },
  { title: 'Research Swarm', kind: 'Swarm', trust: 'verified', summary: 'Multi-agent web research', price: '900 cr/mo', rating: '4.7', icon: Bot, buy: true },
  { title: 'Upscale-XL', kind: 'Model', trust: 'official', summary: 'ONNX 4× image upscaler', price: '12 cr/use', rating: '4.8', icon: Cpu, buy: true },
  { title: 'Palette Studio', kind: 'Panel', trust: 'community', summary: 'Agent workbench panel', price: 'Free', rating: '4.5', icon: Plug },
  { title: 'Copy Editor Mind', kind: 'Mind', trust: 'verified', summary: 'Rent a hosted editor agent', price: '$6/mo', rating: '4.6', icon: Bot, buy: true },
  { title: 'Flowgrid', kind: 'Sandboxed App', trust: 'community', summary: 'Node automation canvas', price: '1,500 cr', rating: '4.4', icon: Boxes, buy: true },
];

function Card({ l }: { l: (typeof listings)[number] }) {
  const Icon = l.icon;
  return (
    <div className="flex flex-col rounded-[10px] border border-white/[0.06] bg-white/[0.02] p-2.5">
      <div className="flex items-start gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] bg-white/[0.05] text-[#807970]">
          <Icon className="h-4 w-4" strokeWidth={1.5} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12px] font-medium text-[#e7e2d9]">{l.title}</span>
            <span className={`shrink-0 rounded-[3px] border px-1 py-px text-[8px] font-medium ${trustCls[l.trust]}`}>{trustLabel[l.trust]}</span>
          </div>
          <p className="truncate text-[10px] text-[#69635b]">{l.summary}</p>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="flex items-center gap-2 text-[9px] text-[#4f4a44]">
          <span className="rounded-[3px] bg-white/[0.05] px-1.5 py-0.5 text-[#807970]">{l.kind}</span>
          <span className="flex items-center gap-0.5"><Star className="h-2.5 w-2.5 fill-current" />{l.rating}</span>
        </span>
        <button className={`flex h-6 items-center gap-1 rounded-[6px] px-2 text-[9px] font-medium ${l.buy ? 'text-white acc-b' : 'text-[#cdc7be] bg-white/[0.06]'}`}>
          {l.buy ? <ShoppingCart className="h-2.5 w-2.5" strokeWidth={1.6} /> : <Download className="h-2.5 w-2.5" strokeWidth={1.6} />}
          {l.price}
        </button>
      </div>
    </div>
  );
}

const XenoHubStore: React.FC = () => (
  <div className="mx-auto w-full overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0d0d0f] shadow-[0_40px_100px_-45px_rgba(0,0,0,0.9)]">
    {/* titlebar */}
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
      <span className="ml-2 flex items-center gap-1.5 text-[11px] text-[#69635b]"><Store className="h-3.5 w-3.5" strokeWidth={1.5} />XENO Marketplace</span>
    </div>

    <div className="flex min-h-[300px] text-left">
      {/* shelf rail */}
      <aside className="hidden w-[168px] shrink-0 flex-col gap-0.5 border-r border-white/[0.06] bg-[#0a0a0c] p-2.5 sm:flex">
        <span className="mb-1.5 px-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#4f4a44]">Shelves</span>
        {shelves.map(({ id, label, icon: Icon, active }) => (
          <span key={id} className={`flex items-center gap-2 rounded-[7px] px-2 py-1.5 text-[11px] ${active ? 'acc-b10 acc-fg' : 'text-[#807970]'}`}>
            <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />{label}
          </span>
        ))}
        <span className="mt-auto rounded-[7px] border acc-bd20 acc-b06 px-2 py-2 text-[9.5px] leading-snug text-[#827b71]">
          Paid items meter on your <span className="acc-fg-hi">credits</span> balance.
        </span>
      </aside>

      {/* catalog */}
      <section className="flex min-w-0 flex-1 flex-col bg-[#0d0d0f]">
        <div className="border-b border-white/[0.06] px-4 py-2.5">
          <div className="flex items-center gap-1.5 rounded-[8px] border border-white/[0.07] bg-white/[0.02] px-2.5 py-1.5">
            <Search className="h-3 w-3 text-[#5d5850]" strokeWidth={1.5} />
            <span className="text-[11px] text-[#5d5850]">Search apps, agents, plugins & models</span>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 overflow-hidden p-4 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((l, i) => (
            <Reveal key={l.title} y={8} delay={i * 45}><Card l={l} /></Reveal>
          ))}
        </div>
      </section>
    </div>
  </div>
);

export default XenoHubStore;
